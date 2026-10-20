// 로컬 HTTP 서버 — 전송과 관문만(앱 동작은 routes.ts). 127.0.0.1과 ::1에만, 주소에는 1회용 코드만(스펙 §5-2·§5-5)
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { asset } from './assets';
import { HttpError } from './errors';
import { BASE_HEADERS, PAGE_CSP, PAGE_CSP_REMOTE_IMAGES, checkApi, checkControl, hostAllowed } from './security';

export const CODE_TTL_MS = 2 * 60 * 1000;
export const IDLE_MS = 8 * 60 * 60 * 1000;
const MAX_BODY = 1024 * 1024;

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer | string;
  type?: string;
  headers?: Record<string, string>;
}

export interface AppHandlers {
  api(method: string, path: string, url: URL, body: unknown): Promise<Reply> | Reply;
  file(id: string): Reply;
  controlBase(body: unknown): Promise<void> | void;
}

export interface ServerOptions {
  app: AppHandlers;
  idleMs?: number;
  /** 시험용 — 먼저 써 볼 포트 */
  ports?: number[];
  now?: () => number;
  /** /control/ping이 돌려줄 값 — CLI가 살아 있는 서버인지, 같은 worktree인지 본다 */
  pid?: number;
  root?: string;
}

export interface RunningServer {
  port: number;
  ipv6: boolean;
  controlSecret: string;
  newCodeUrl(): string;
  close(): Promise<void>;
  closed: Promise<void>;
}

const token = (bytes: number): string => randomBytes(bytes).toString('hex');

/** 페이지 껍데기 — 비밀이 없는 껍데기는 코드 없이도 내준다(새로고침·원격 이미지 다시 열기). API만 세션 비밀로 연다 */
export function pageShell(metas: string[]): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Markdown Diff Cat — review</title>',
    '<link rel="stylesheet" href="/assets/page.css">',
    '<link rel="stylesheet" href="/assets/katex.css">',
    ...metas,
    '<script src="/assets/page.js" defer></script>',
    '</head>',
    '<body><main id="mdc-app"></main></body>',
    '</html>',
    '',
  ].join('\n');
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen({ host, port, ipv6Only: host === '::1', exclusive: true }, () => {
      server.off('error', fail);
      ok();
    });
  });
}

const closeOne = (s: Server): Promise<void> =>
  new Promise((ok) => {
    s.close(() => ok());
    s.closeAllConnections();
  });

/**
 * 같은 포트로 127.0.0.1과 ::1을 잡는다. ::1 쪽이 EADDRINUSE면 주소를 알리기 전에 다른 포트로(다른 프로세스가 [::1]:<포트>를
 * 먼저 잡으면 localhost가 ::1로 풀릴 때 첫 요청을 가로챈다). IPv6이 없을 때(EADDRNOTAVAIL·EAFNOSUPPORT)만 127.0.0.1 하나로
 */
export async function bindLoopback(handler: RequestListener, preferred: number[] = []): Promise<{ servers: Server[]; port: number; ipv6: boolean }> {
  let last: unknown = null;
  for (const want of [...preferred, ...Array<number>(20).fill(0)]) {
    const v4 = createServer(handler);
    try {
      await listen(v4, '127.0.0.1', want);
    } catch (e) {
      last = e;
      continue;
    }
    const port = (v4.address() as AddressInfo).port;
    const v6 = createServer(handler);
    try {
      await listen(v6, '::1', port);
      return { servers: [v4, v6], port, ipv6: true };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') return { servers: [v4], port, ipv6: false };
      await closeOne(v4);
      last = e;
    }
  }
  throw new Error(`cannot listen on 127.0.0.1: ${last instanceof Error ? last.message : 'no free port'}`);
}

function send(res: ServerResponse, reply: Reply): void {
  const body = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.body ?? '');
  const type = reply.json !== undefined ? 'application/json; charset=utf-8' : (reply.type ?? 'text/plain; charset=utf-8');
  res.writeHead(reply.status, { ...BASE_HEADERS, 'Content-Type': type, ...reply.headers });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new HttpError(413, 'request body is too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return ok(undefined);
      try {
        ok(JSON.parse(text));
      } catch {
        fail(new HttpError(400, 'request body is not JSON'));
      }
    });
    req.on('error', fail);
  });
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const now = opts.now ?? Date.now;
  const idleMs = opts.idleMs ?? IDLE_MS;
  const controlSecret = token(32);
  const codes = new Map<string, number>(); // 1회용 코드 → 만료 시각
  const sessions = new Set<string>();
  let port = 0;
  let last = now();
  let servers: Server[] = [];
  let closing: Promise<void> | null = null;
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((ok) => (resolveClosed = ok));

  const newCodeUrl = (): string => {
    for (const [c, exp] of codes) if (exp < now()) codes.delete(c);
    const code = token(16);
    codes.set(code, now() + CODE_TTL_MS);
    return `http://localhost:${port}/?code=${code}`;
  };

  const close = (): Promise<void> =>
    (closing ??= (async () => {
      clearInterval(idleTimer);
      await Promise.all(servers.map(closeOne));
      resolveClosed();
    })());

  /** 코드를 처음 받을 때 세션 비밀로 바꿔 <meta>로 넘긴다. 쓴 코드·만료 코드는 안내 표시만(그 탭에 비밀이 없을 때 페이지가 보인다) */
  const page = (url: URL): Reply => {
    const metas: string[] = [];
    const code = url.searchParams.get('code');
    if (code !== null) {
      const exp = codes.get(code);
      if (exp !== undefined && exp >= now()) {
        codes.delete(code);
        const secret = token(32);
        sessions.add(secret);
        metas.push(`<meta name="mdc-session" content="${secret}">`);
      } else {
        metas.push(`<meta name="mdc-code" content="${exp === undefined ? 'unknown' : 'expired'}">`);
      }
    }
    const remote = url.searchParams.get('remote') === '1';
    if (remote) metas.push('<meta name="mdc-remote" content="1">');
    return { status: 200, type: 'text/html; charset=utf-8', body: pageShell(metas), headers: { 'Content-Security-Policy': remote ? PAGE_CSP_REMOTE_IMAGES : PAGE_CSP } };
  };

  const control = async (req: IncomingMessage, path: string): Promise<Reply> => {
    if (req.method === 'GET' && path === '/control/ping') return { status: 200, json: { pid: opts.pid ?? process.pid, root: opts.root ?? '', port } };
    if (req.method !== 'POST') return { status: 405, json: { error: 'method not allowed' } };
    if (path === '/control/code') return { status: 200, json: { url: newCodeUrl() } };
    if (path === '/control/base') {
      await opts.app.controlBase(await readBody(req));
      return { status: 200, json: { url: newCodeUrl() } };
    }
    if (path === '/control/stop') {
      setImmediate(() => void close());
      return { status: 200, json: { ok: true } };
    }
    return { status: 404, json: { error: 'no such control' } };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host;
    if (!hostAllowed(host, port)) return send(res, { status: 403, body: 'Forbidden host' });
    if (req.method === 'OPTIONS') return send(res, { status: 403, body: 'Forbidden' });
    const url = new URL(req.url ?? '/', `http://${host}`);
    const path = url.pathname;
    if (path.startsWith('/control/')) {
      if (!checkControl(req.headers, controlSecret).ok) return send(res, { status: 403, json: { error: 'forbidden' } });
      last = now();
      return send(res, await control(req, path));
    }
    if (req.method === 'GET' && path === '/') {
      last = now();
      return send(res, page(url));
    }
    if (req.method === 'GET' && path.startsWith('/assets/')) {
      const a = asset(decodeURIComponent(path.slice('/assets/'.length)));
      return send(res, a ? { status: 200, body: a.body, type: a.type } : { status: 404, body: 'Not found' });
    }
    if (req.method === 'GET' && path.startsWith('/file/')) return send(res, opts.app.file(path.slice('/file/'.length)));
    if (path.startsWith('/api/')) {
      if (!checkApi(req.headers, port, sessions).ok) return send(res, { status: 403, json: { error: 'forbidden' } });
      if (path !== '/api/poll') last = now(); // 폴링은 유휴 시간을 늘리지 않는다
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
      return send(res, await opts.app.api(req.method ?? 'GET', path, url, body));
    }
    return send(res, { status: 404, body: 'Not found' });
  };

  const listener: RequestListener = (req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) return res.destroy();
      send(res, e instanceof HttpError ? { status: e.status, json: { error: e.message } } : { status: 500, json: { error: e instanceof Error ? e.message : String(e) } });
    });
  };

  const bound = await bindLoopback(listener, opts.ports ?? []);
  servers = bound.servers;
  port = bound.port;
  const idleTimer = setInterval(() => {
    if (now() - last > idleMs) void close();
  }, Math.max(50, Math.min(60_000, Math.floor(idleMs / 4))));
  idleTimer.unref();
  return { port, ipv6: bound.ipv6, controlSecret, newCodeUrl, close, closed };
}

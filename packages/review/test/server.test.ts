import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { PAGE_CSP, PAGE_CSP_REMOTE_IMAGES } from '../src/security';
import { bindLoopback, startServer, type AppHandlers, type RunningServer } from '../src/server';
import { exchange, pageHeaders, request } from './helpers/http';

const running: RunningServer[] = [];
afterEach(async () => {
  for (const s of running.splice(0)) await s.close();
});
const calls: string[] = [];
const app: AppHandlers = {
  api: (method, path, url) => (calls.push(`${method} ${path}${url.search}`), { status: 200, json: { ok: true, path } }),
  file: (id) => (id === 'a'.repeat(32) ? { status: 200, body: '<svg/>', type: 'image/svg+xml', headers: { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Content-Disposition': 'attachment' } } : { status: 404, body: 'Not found' }),
  controlBase: (body) => void calls.push(`base ${JSON.stringify(body)}`),
};
async function start(extra: Partial<Parameters<typeof startServer>[0]> = {}): Promise<RunningServer> {
  const s = await startServer({ app, pid: 4242, root: '/repo', ...extra });
  running.push(s);
  return s;
}
const hasIpv6 = await new Promise<boolean>((ok) => {
  const t = createServer();
  t.once('error', () => ok(false));
  t.listen({ host: '::1', port: 0, ipv6Only: true }, () => t.close(() => ok(true)));
});

describe('바인딩', () => {
  it('같은 포트로 127.0.0.1과 ::1을 잡고 안내 주소는 localhost', async () => {
    const s = await start();
    expect(s.newCodeUrl()).toMatch(new RegExp(`^http://localhost:${s.port}/\\?code=[0-9a-f]{32}$`));
    expect((await request(s.port, { path: '/' })).status).toBe(200);
    if (hasIpv6) expect((await request(s.port, { path: '/', host: '::1', headers: { host: `[::1]:${s.port}` } })).status).toBe(200);
  });
  it.skipIf(!hasIpv6)('::1의 그 포트를 누가 쓰고 있으면 그 포트로 안내하지 않고 다른 포트를 고른다', async () => {
    const squatter = createServer();
    await new Promise<void>((ok) => squatter.listen({ host: '::1', port: 0, ipv6Only: true }, () => ok()));
    const taken = (squatter.address() as { port: number }).port;
    const { servers, port } = await bindLoopback(() => {}, [taken]);
    expect(port).not.toBe(taken);
    for (const s of [...servers, squatter]) await new Promise<void>((ok) => s.close(() => ok()));
  });
  it('서버 둘이 동시에 다른 포트로 돈다', async () => {
    const a = await start();
    const b = await start();
    expect(a.port).not.toBe(b.port);
    expect((await request(b.port, { path: '/' })).status).toBe(200);
  });
});

describe('관문', () => {
  it('Host가 허용 목록 밖이면 403, OPTIONS는 403이고 CORS 머리는 없다', async () => {
    const s = await start();
    expect((await request(s.port, { path: '/', headers: { host: `evil.example:${s.port}` } })).status).toBe(403);
    const opt = await request(s.port, { method: 'OPTIONS', path: '/api/view', headers: { origin: 'https://evil.example' } });
    expect(opt.status).toBe(403);
    expect(Object.keys(opt.headers).some((h) => h.startsWith('access-control-'))).toBe(false);
  });
  it('페이지 껍데기 — CSP 그대로, 응답 머리 셋, 원격 이미지 보기는 https:를 더한 CSP', async () => {
    const s = await start();
    const page = await request(s.port, { path: '/' });
    expect(page.headers['content-security-policy']).toBe(PAGE_CSP);
    expect(page.headers['referrer-policy']).toBe('no-referrer');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['set-cookie']).toBeUndefined();
    expect(page.text).toContain('<script src="/assets/page.js" defer></script>');
    expect((await request(s.port, { path: '/?remote=1' })).headers['content-security-policy']).toBe(PAGE_CSP_REMOTE_IMAGES);
  });
  it('1회용 코드는 한 번만 세션 비밀로 바뀐다 — 다시 쓰거나 2분이 지나면 안내만', async () => {
    let clock = 1_000_000;
    const s = await start({ now: () => clock });
    const url = s.newCodeUrl();
    const secret = await exchange(s.port, url);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const again = await request(s.port, { path: new URL(url).pathname + new URL(url).search });
    expect(again.text).not.toContain('mdc-session');
    expect(again.text).toContain('<meta name="mdc-code" content="unknown">');
    const late = s.newCodeUrl();
    clock += 121_000;
    expect((await request(s.port, { path: `/${new URL(late).search}` })).text).toContain('<meta name="mdc-code" content="expired">');
  });
  it('API는 세션 + 같은 출처일 때만 앱에 닿는다', async () => {
    const s = await start();
    const secret = await exchange(s.port, s.newCodeUrl());
    calls.length = 0;
    expect((await request(s.port, { path: '/api/view' })).status).toBe(403);
    expect((await request(s.port, { path: '/api/view', headers: { 'x-mdc-session': secret } })).status).toBe(403);
    expect((await request(s.port, { path: '/api/view', headers: { 'x-mdc-session': secret, origin: `http://localhost:${s.port + 1}` } })).status).toBe(403);
    const ok = await request(s.port, { path: '/api/view?x=1', headers: { 'x-mdc-session': secret, 'sec-fetch-site': 'same-origin' } });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.text)).toEqual({ ok: true, path: '/api/view' });
    expect((await request(s.port, { method: 'POST', path: '/api/send', headers: pageHeaders(s.port, secret), body: { rev: 'r1' } })).status).toBe(200);
    expect(calls).toEqual(['GET /api/view?x=1', 'POST /api/send']);
  });
  it('제어 API는 비밀만 — 브라우저 출처가 붙으면 거부, ping·code·base가 돈다', async () => {
    const s = await start();
    const control = { 'x-mdc-control': s.controlSecret };
    expect((await request(s.port, { path: '/control/ping' })).status).toBe(403);
    expect((await request(s.port, { path: '/control/ping', headers: { ...control, origin: `http://localhost:${s.port}` } })).status).toBe(403);
    expect(JSON.parse((await request(s.port, { path: '/control/ping', headers: control })).text)).toEqual({ pid: 4242, root: '/repo', port: s.port, mode: 'worktree' });
    expect(JSON.parse((await request(s.port, { method: 'POST', path: '/control/code', headers: control })).text).url).toMatch(/\?code=/);
    calls.length = 0;
    const res = await request(s.port, { method: 'POST', path: '/control/base', headers: control, body: { view: 'since-last' } });
    expect(JSON.parse(res.text).url).toMatch(/\?code=/);
    expect(calls).toEqual(['base {"view":"since-last"}']);
  });
  it('/control/stop은 응답하고 서버를 닫는다', async () => {
    const s = await start();
    const res = await request(s.port, { method: 'POST', path: '/control/stop', headers: { 'x-mdc-control': s.controlSecret } });
    expect(res.status).toBe(200);
    await s.closed;
    await expect(request(s.port, { path: '/' })).rejects.toThrow();
  });
  it('자산은 /assets/<이름>, 모르는 이름은 404', async () => {
    const s = await start();
    const js = await request(s.port, { path: '/assets/page.js' });
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect((await request(s.port, { path: '/assets/nope.js' })).status).toBe(404);
  });
  it('/file/<id>는 앱이 준 머리를 그대로 싣고 응답 머리 셋을 더한다', async () => {
    const s = await start();
    const res = await request(s.port, { path: `/file/${'a'.repeat(32)}` });
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('유휴 종료', () => {
  it('폴링만 오가면 유휴 시간 뒤 스스로 끝난다', async () => {
    const s = await start({ idleMs: 400 });
    const secret = await exchange(s.port, s.newCodeUrl());
    const timer = setInterval(() => void request(s.port, { path: '/api/poll?rev=r', headers: { 'x-mdc-session': secret, 'sec-fetch-site': 'same-origin' } }).catch(() => {}), 50);
    await s.closed;
    clearInterval(timer);
  });
  it('사람 동작(폴링 아닌 요청)은 유휴 시간을 늘린다', async () => {
    const s = await start({ idleMs: 400 });
    const secret = await exchange(s.port, s.newCodeUrl());
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 150));
      expect((await request(s.port, { path: '/api/view', headers: { 'x-mdc-session': secret, 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
    }
  });
});

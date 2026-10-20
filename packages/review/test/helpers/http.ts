// Host 헤더까지 마음대로 싣는 요청(fetch는 Host를 바꾸지 못한다)과 1회용 코드 교환
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';

export interface Res {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

export function request(port: number, o: { method?: string; path: string; headers?: Record<string, string>; body?: unknown; host?: string }): Promise<Res> {
  return new Promise((ok, fail) => {
    const data = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = httpRequest(
      { host: o.host ?? '127.0.0.1', port, method: o.method ?? 'GET', path: o.path, setHost: false, headers: { host: `127.0.0.1:${port}`, ...(data ? { 'content-type': 'application/json' } : {}), ...o.headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (text += c));
        res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, text }));
      },
    );
    req.on('error', fail);
    if (data) req.write(data);
    req.end();
  });
}

/** newCodeUrl()의 주소로 껍데기를 받아 meta의 세션 비밀을 꺼낸다 */
export async function exchange(port: number, codeUrl: string): Promise<string> {
  const res = await request(port, { path: new URL(codeUrl).pathname + new URL(codeUrl).search });
  const m = /<meta name="mdc-session" content="([0-9a-f]+)">/.exec(res.text);
  if (!m) throw new Error(`no session in page: ${res.text.slice(0, 200)}`);
  return m[1];
}

/** 페이지에서 온 것처럼(세션 + 같은 출처) */
export const pageHeaders = (port: number, session: string): Record<string, string> => ({ 'x-mdc-session': session, origin: `http://127.0.0.1:${port}` });

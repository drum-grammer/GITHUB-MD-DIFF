// 로컬 서버 보안 판정(스펙 §5-5) — 순수 함수와 상수만. server.ts가 요청마다 부른다
import { timingSafeEqual } from 'node:crypto';

export const SESSION_HEADER = 'x-mdc-session';
export const CONTROL_HEADER = 'x-mdc-control';

/** style-src의 'unsafe-inline'은 KaTeX·mermaid 인라인 스타일 때문(원문의 style 속성은 정화기가 먼저 지운다) */
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
/** "원격 이미지 보기"를 고른 뒤에만 — img-src에 https:만 더한다 */
export const PAGE_CSP_REMOTE_IMAGES = PAGE_CSP.replace("img-src 'self' data:", "img-src 'self' data: https:");
/** /file/<id> — SVG가 최상위로 열려도 스크립트가 돌지 않게 */
export const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
export const BASE_HEADERS: Readonly<Record<string, string>> = { 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

type Headers = Record<string, string | string[] | undefined>;
const one = (h: Headers, key: string): string | undefined => {
  const v = h[key];
  return Array.isArray(v) ? v[0] : v;
};

export function allowedHosts(port: number): string[] {
  return [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
}

export function hostAllowed(host: string | undefined, port: number): boolean {
  return host !== undefined && allowedHosts(port).includes(host.toLowerCase());
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type Gate = { ok: true } | { ok: false; reason: string };

/** 페이지 API — 세션 헤더 + 출처가 페이지와 같은지(POST는 Origin, GET은 Sec-Fetch-Site: same-origin) */
export function checkApi(h: Headers, port: number, sessions: ReadonlySet<string>): Gate {
  const secret = one(h, SESSION_HEADER);
  if (!secret || ![...sessions].some((s) => safeEqual(s, secret))) return { ok: false, reason: 'session' };
  const origin = one(h, 'origin');
  const host = one(h, 'host');
  if (origin !== undefined) return host !== undefined && hostAllowed(host, port) && origin === `http://${host.toLowerCase()}` ? { ok: true } : { ok: false, reason: 'origin' };
  return one(h, 'sec-fetch-site') === 'same-origin' ? { ok: true } : { ok: false, reason: 'origin' };
}

/** 제어 API — 제어 비밀 헤더만. Origin이나 Sec-Fetch-Site가 붙은 요청(브라우저에서 온 것)은 거부 */
export function checkControl(h: Headers, secret: string): Gate {
  if (one(h, 'origin') !== undefined || one(h, 'sec-fetch-site') !== undefined) return { ok: false, reason: 'browser' };
  const given = one(h, CONTROL_HEADER);
  return given && safeEqual(given, secret) ? { ok: true } : { ok: false, reason: 'secret' };
}

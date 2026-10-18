import { describe, expect, it } from 'vitest';
import { FILE_CSP, PAGE_CSP, PAGE_CSP_REMOTE_IMAGES, checkApi, checkControl, hostAllowed } from '../src/security';

describe('CSP', () => {
  it('페이지 CSP는 스펙 §5-5 글자 그대로', () => {
    expect(PAGE_CSP).toBe("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    expect(PAGE_CSP_REMOTE_IMAGES).toBe(PAGE_CSP.replace("img-src 'self' data:", "img-src 'self' data: https:"));
    expect(FILE_CSP).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  });
});

describe('hostAllowed — DNS rebinding 막기', () => {
  it.each([
    ['localhost:4000', true],
    ['127.0.0.1:4000', true],
    ['[::1]:4000', true],
    ['LOCALHOST:4000', true],
    ['localhost:4001', false],
    ['evil.example:4000', false],
    ['127.0.0.1', false],
    [undefined, false],
  ])('%s → %s', (host, want) => {
    expect(hostAllowed(host, 4000)).toBe(want);
  });
});

describe('checkApi', () => {
  const sessions = new Set(['s'.repeat(64)]);
  const ok = { 'x-mdc-session': 's'.repeat(64), host: 'localhost:4000' };
  it('세션 + 같은 출처 Origin, 또는 Origin 없이 Sec-Fetch-Site: same-origin', () => {
    expect(checkApi({ ...ok, origin: 'http://localhost:4000' }, 4000, sessions)).toEqual({ ok: true });
    expect(checkApi({ ...ok, 'sec-fetch-site': 'same-origin' }, 4000, sessions)).toEqual({ ok: true });
  });
  it('세션 없음·틀림, 다른 포트·다른 사이트 출처, 출처 표시 없음은 거부', () => {
    expect(checkApi({ host: 'localhost:4000', origin: 'http://localhost:4000' }, 4000, sessions).ok).toBe(false);
    expect(checkApi({ ...ok, 'x-mdc-session': 'x', origin: 'http://localhost:4000' }, 4000, sessions).ok).toBe(false);
    expect(checkApi({ ...ok, origin: 'http://localhost:9999' }, 4000, sessions).ok).toBe(false);
    expect(checkApi({ ...ok, origin: 'https://evil.example' }, 4000, sessions).ok).toBe(false);
    expect(checkApi({ ...ok, 'sec-fetch-site': 'cross-site' }, 4000, sessions).ok).toBe(false);
    expect(checkApi(ok, 4000, sessions).ok).toBe(false);
  });
});

describe('checkControl', () => {
  it('제어 비밀만 — 브라우저에서 온 요청(Origin·Sec-Fetch-Site)은 비밀이 맞아도 거부', () => {
    expect(checkControl({ 'x-mdc-control': 'c' }, 'c')).toEqual({ ok: true });
    expect(checkControl({ 'x-mdc-control': 'd' }, 'c').ok).toBe(false);
    expect(checkControl({}, 'c').ok).toBe(false);
    expect(checkControl({ 'x-mdc-control': 'c', origin: 'http://localhost:4000' }, 'c').ok).toBe(false);
    expect(checkControl({ 'x-mdc-control': 'c', 'sec-fetch-site': 'same-origin' }, 'c').ok).toBe(false);
  });
});

// @vitest-environment node
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CwsError,
  DEFAULT_PUBLISHER_ID,
  ITEM_ID,
  accessToken,
  createClient,
  publishedVersion,
  serviceAccountJwt,
  summarizeStatus,
  waitForUpload,
} from '../scripts/cws.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const KEY = { client_email: 'bot@p.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' };

/** 응답을 차례로 돌려주는 가짜 fetch */
function fakeFetch(...responses: Array<[number, unknown]>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const [status, body] = responses.shift() ?? [500, { error: { message: '응답 없음' } }];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe('서비스 계정 토큰', () => {
  it('JWT는 RS256으로 서명되고 범위·발급자·만료가 맞다', () => {
    const jwt = serviceAccountJwt(KEY, 1_700_000_000_000);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({
      iss: KEY.client_email,
      scope: 'https://www.googleapis.com/auth/chromewebstore',
      aud: KEY.token_uri,
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('CWS_ACCESS_TOKEN이 있으면 그대로 쓰고 교환하지 않는다', async () => {
    const { impl } = fakeFetch();
    expect(await accessToken({ CWS_ACCESS_TOKEN: 'tok' }, impl)).toBe('tok');
    expect(impl).not.toHaveBeenCalled();
  });

  it('키가 없으면 null', async () => expect(await accessToken({}, fakeFetch().impl)).toBeNull());

  it('키로 JWT를 만들어 토큰과 바꾼다', async () => {
    const { impl, calls } = fakeFetch([200, { access_token: 'abc' }]);
    expect(await accessToken({ CWS_SERVICE_ACCOUNT_KEY: JSON.stringify(KEY) }, impl)).toBe('abc');
    expect(calls[0].url).toBe(KEY.token_uri);
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(form.get('assertion')?.split('.')).toHaveLength(3);
  });

  it('JSON이 아닌 키는 내용을 찍지 않고 이유만 말한다', async () => {
    const broken = `{"client_email":"bot@p","private_key":"${privateKey}"`; // 닫는 괄호 없음
    const err = await accessToken({ CWS_SERVICE_ACCOUNT_KEY: broken }, fakeFetch().impl).catch((e) => e);
    expect(err).toBeInstanceOf(CwsError);
    expect(err.message).toContain('JSON');
    expect(err.message).not.toContain('PRIVATE KEY');
  });

  it('교환이 거절되면 HTTP 상태와 Google의 설명을 담는다', async () => {
    const { impl } = fakeFetch([400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }]);
    const err = await accessToken({ CWS_SERVICE_ACCOUNT_KEY: JSON.stringify(KEY) }, impl).catch((e) => e);
    expect(err.message).toContain('HTTP 400');
    expect(err.message).toContain('Invalid JWT Signature.');
  });
});

describe('스토어 API', () => {
  const base = 'https://chromewebstore.googleapis.com';
  const name = `publishers/${DEFAULT_PUBLISHER_ID}/items/${ITEM_ID}`;

  it('fetchStatus·upload·publish는 문서의 주소와 본문으로 부른다', async () => {
    const { impl, calls } = fakeFetch([200, {}], [200, { uploadState: 'SUCCEEDED', crxVersion: '1.1.1' }], [200, { state: 'PENDING_REVIEW' }]);
    const cws = createClient({ token: 'tok', fetchImpl: impl });
    await cws.fetchStatus();
    await cws.upload(Buffer.from('zip'));
    expect(await cws.publish()).toEqual({ state: 'PENDING_REVIEW' });
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', `${base}/v2/${name}:fetchStatus`],
      ['POST', `${base}/upload/v2/${name}:upload`],
      ['POST', `${base}/v2/${name}:publish`],
    ]);
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(String(calls[1].init.body)).toBe('zip');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ publishType: 'DEFAULT_PUBLISH' });
  });

  it('게시자 ID를 바꿀 수 있다', async () => {
    const { impl, calls } = fakeFetch([200, {}]);
    await createClient({ token: 't', publisherId: 'other', fetchImpl: impl }).fetchStatus();
    expect(calls[0].url).toContain('/publishers/other/items/');
  });

  it('오류 응답은 상태 코드와 메시지를 담은 CwsError', async () => {
    const { impl } = fakeFetch([403, { error: { message: 'The caller does not have permission' } }]);
    const err = await createClient({ token: 't', fetchImpl: impl }).fetchStatus().catch((e) => e);
    expect(err).toBeInstanceOf(CwsError);
    expect(err.status).toBe(403);
    expect(err.message).toContain('The caller does not have permission');
  });

  it('JSON이 아닌 오류 본문(HTML)도 죽지 않고 앞부분만 보여 준다', async () => {
    const { impl } = fakeFetch([502, `<html>${'x'.repeat(1000)}</html>`]);
    const err = await createClient({ token: 't', fetchImpl: impl }).fetchStatus().catch((e) => e);
    expect(err.message).toContain('HTTP 502');
    expect(err.message.length).toBeLessThan(400);
  });
});

describe('업로드 기다리기', () => {
  const sleep = async () => undefined;
  const statusClient = (...states: string[]) => ({ fetchStatus: vi.fn(async () => ({ lastAsyncUploadState: states.shift() })) });

  it('바로 성공하면 그대로', async () => {
    const first = { uploadState: 'SUCCEEDED', crxVersion: '1.1.1' };
    expect(await waitForUpload(statusClient(), first, { sleep })).toBe(first);
  });

  it('처리 중(IN_PROGRESS·UPLOAD_IN_PROGRESS)이면 fetchStatus로 끝날 때까지 본다', async () => {
    for (const pending of ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']) {
      const c = statusClient('IN_PROGRESS', 'SUCCEEDED');
      expect((await waitForUpload(c, { uploadState: pending }, { sleep })).uploadState).toBe('SUCCEEDED');
      expect(c.fetchStatus).toHaveBeenCalledTimes(2);
    }
  });

  it('실패나 시간 초과는 CwsError', async () => {
    await expect(waitForUpload(statusClient('FAILED'), { uploadState: 'IN_PROGRESS' }, { sleep })).rejects.toThrow('FAILED');
    await expect(waitForUpload(statusClient(), { uploadState: 'FAILED' }, { sleep })).rejects.toThrow('FAILED');
    const forever = { fetchStatus: async () => ({ lastAsyncUploadState: 'IN_PROGRESS' }) };
    await expect(waitForUpload(forever, { uploadState: 'IN_PROGRESS' }, { sleep, intervalMs: 1, timeoutMs: 3 })).rejects.toThrow('초 안에');
  });
});

describe('상태 요약', () => {
  it('게시·심사 중 버전과 상태를 뽑는다', () => {
    const s = summarizeStatus({
      publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '1.0.0', deployPercentage: 100 }] },
      submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '1.1.1' }] },
      lastAsyncUploadState: 'SUCCEEDED',
    });
    expect(s).toEqual({
      published: { state: 'PUBLISHED', versions: ['1.0.0'] },
      submitted: { state: 'PENDING_REVIEW', versions: ['1.1.1'] },
      lastUpload: 'SUCCEEDED',
      takenDown: false,
      warned: false,
    });
    expect(publishedVersion(s)).toBe('1.0.0');
  });

  it('없는 항목은 null', () => {
    const s = summarizeStatus({});
    expect(s.published).toBeNull();
    expect(s.submitted).toBeNull();
    expect(publishedVersion(s)).toBeNull();
  });
});

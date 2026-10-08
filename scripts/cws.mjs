// Chrome Web Store API v2 — 스토어 업데이트 하네스(pnpm release)가 쓴다
// 인증: CWS_SERVICE_ACCOUNT_KEY(서비스 계정 JSON 키 전체)로 JWT를 만들어 토큰으로 바꾼다. 급할 때는 CWS_ACCESS_TOKEN을 그대로
// 문서: https://developer.chrome.com/docs/webstore/using-api · https://developer.chrome.com/docs/webstore/service-accounts (2026-10-08 확인)
import { createSign } from 'node:crypto';

export const ITEM_ID = 'kabekbbeoajhpbcppidepmcbbjjochlj';
// 개발자 대시보드 주소(devconsole/<id>)의 값 — 게시자 설정의 ID와 같은지는 첫 release status가 확인한다
export const DEFAULT_PUBLISHER_ID = '1679ec25-b84c-44d3-8b31-357020b6b255';
export const LISTING_URL = 'https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj';
const API = 'https://chromewebstore.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

export class CwsError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status) {
    super(message);
    this.name = 'CwsError';
    this.status = status;
  }
}

const b64url = (v) => Buffer.from(v).toString('base64url');

/** 서비스 계정 키로 1시간짜리 RS256 JWT */
export function serviceAccountJwt(key, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000);
  const claims = { iss: key.client_email, scope: SCOPE, aud: key.token_uri ?? TOKEN_URI, iat, exp: iat + 3600 };
  const input = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  return `${input}.${b64url(createSign('RSA-SHA256').update(input).sign(key.private_key))}`;
}

/** 토큰 — CWS_ACCESS_TOKEN, 없으면 CWS_SERVICE_ACCOUNT_KEY로 교환. 둘 다 없으면 null. 키 내용은 어떤 메시지에도 넣지 않는다 */
export async function accessToken(env = process.env, fetchImpl = fetch, nowMs = Date.now()) {
  if (env.CWS_ACCESS_TOKEN) return env.CWS_ACCESS_TOKEN;
  const raw = env.CWS_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new CwsError('CWS_SERVICE_ACCOUNT_KEY가 JSON이 아니다 — 내려받은 키 파일 내용 전체를 그대로 넣는다');
  }
  if (!key.client_email || !key.private_key) throw new CwsError('CWS_SERVICE_ACCOUNT_KEY에 client_email·private_key가 없다 — 서비스 계정 키(JSON)인지 확인');
  const res = await fetchImpl(key.token_uri ?? TOKEN_URI, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountJwt(key, nowMs) }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.access_token !== 'string') {
    throw new CwsError(`토큰 교환 실패 (HTTP ${res.status}): ${body.error_description ?? body.error ?? '응답 없음'}`, res.status);
  }
  return body.access_token;
}

/** 항목 하나를 다루는 클라이언트. 오류 응답은 CwsError(상태 코드·메시지) */
export function createClient({ token, publisherId = DEFAULT_PUBLISHER_ID, itemId = ITEM_ID, fetchImpl = fetch }) {
  const name = `publishers/${publisherId}/items/${itemId}`;
  async function call(method, path, body, headers = {}) {
    const res = await fetchImpl(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...headers }, body });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok) throw new CwsError(`${method} ${path} → HTTP ${res.status}: ${json.error?.message ?? text.slice(0, 200)}`, res.status);
    return json;
  }
  return {
    fetchStatus: () => call('GET', `/v2/${name}:fetchStatus`),
    // 문서 예시(curl -T)처럼 zip 바이트를 본문 그대로
    upload: (bytes) => call('POST', `/upload/v2/${name}:upload`, bytes),
    publish: (body = { publishType: 'DEFAULT_PUBLISH' }) => call('POST', `/v2/${name}:publish`, JSON.stringify(body), { 'content-type': 'application/json' }),
  };
}

/** 업로드 처리 중인가 — 문서가 IN_PROGRESS(UploadState)와 UPLOAD_IN_PROGRESS(upload 설명)를 둘 다 쓴다(상충) */
export const isUploadInProgress = (state) => state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS';

/** 업로드 응답이 처리 중이면 fetchStatus의 lastAsyncUploadState가 끝날 때까지 기다린다 */
export async function waitForUpload(client, first, { intervalMs = 5000, timeoutMs = 120_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!isUploadInProgress(first.uploadState)) {
    if (first.uploadState !== 'SUCCEEDED') throw new CwsError(`업로드 실패: ${first.uploadState ?? '상태 없음'}`);
    return first;
  }
  for (let waited = 0; waited < timeoutMs; waited += intervalMs) {
    await sleep(intervalMs);
    const state = (await client.fetchStatus()).lastAsyncUploadState;
    if (state === 'SUCCEEDED') return { ...first, uploadState: 'SUCCEEDED' };
    if (!isUploadInProgress(state)) throw new CwsError(`업로드 실패: ${state ?? '상태 없음'}`);
  }
  throw new CwsError(`업로드가 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았다 — pnpm release status로 확인`);
}

/** fetchStatus 응답 → 사람이 볼 요약 */
export function summarizeStatus(raw) {
  const rev = (r) => (r ? { state: r.state ?? 'ITEM_STATE_UNSPECIFIED', versions: (r.distributionChannels ?? []).map((c) => c.crxVersion).filter(Boolean) } : null);
  return {
    published: rev(raw.publishedItemRevisionStatus),
    submitted: rev(raw.submittedItemRevisionStatus),
    lastUpload: raw.lastAsyncUploadState ?? null,
    takenDown: Boolean(raw.takenDown),
    warned: Boolean(raw.warned),
  };
}

export const publishedVersion = (summary) => summary.published?.versions[0] ?? null;

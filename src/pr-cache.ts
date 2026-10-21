/**
 * PR 데이터와 파일 원문 캐시 — 코멘트(블록 ↔ 원문 줄)와 로컬 렌더링(옛·새 원문)이 같은 요청을 한 번만 보낸다.
 * 요청 모양은 github-api.ts에 있다
 */
import { fetchFileText, fetchPrData, prKey, type PrData, type PrRef } from './github-api';

/** PR 데이터를 다시 쓰는 시간 — 그보다 오래되면 새 파일 묶음이 붙을 때 다시 읽는다 */
const PR_TTL_MS = 60_000;

const prCache = new Map<string, { at: number; data: Promise<PrData> }>();
const textCache = new Map<string, Promise<string>>();

/** PR 데이터 — `fresh`면 캐시를 쓰지 않는다. 실패한 요청은 캐시에 남기지 않는다 */
export function loadPr(pr: PrRef, fresh = false): Promise<PrData> {
  const key = prKey(pr);
  const hit = prCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < PR_TTL_MS) return hit.data;
  const data = fetchPrData(pr);
  prCache.set(key, { at: Date.now(), data });
  data.catch(() => prCache.delete(key));
  return data;
}

/** 커밋 하나의 파일 원문 — 커밋은 바뀌지 않으므로 시간 제한 없이 둔다 */
export function loadText(pr: PrRef, oid: string, path: string): Promise<string> {
  const key = `${prKey(pr)}:${oid}:${path}`;
  let text = textCache.get(key);
  if (!text) {
    text = fetchFileText(pr, oid, path);
    textCache.set(key, text);
    text.catch(() => textCache.delete(key));
  }
  return text;
}

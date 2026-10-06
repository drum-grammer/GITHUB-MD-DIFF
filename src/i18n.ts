/** chrome.i18n 문구. 확장 밖(테스트)에서는 "키" 또는 "키:값1|값2"를 돌려준다 */
export function t(key: string, subs: Array<string | number> = []): string {
  const s = subs.map(String);
  const api = (globalThis as { chrome?: typeof chrome }).chrome?.i18n;
  const msg = api?.getMessage ? api.getMessage(key, s) : '';
  return msg || (s.length ? `${key}:${s.join('|')}` : key);
}

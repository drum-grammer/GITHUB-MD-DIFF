/** 같은 새 빌드로 다시 로드를 시도하지 않는 시간 — 크롬이 새 파일을 못 올려도 탭이 끝없이 새로고침되지 않게 */
export const RELOAD_GUARD_MS = 5 * 60 * 1000;

export interface LastReload {
  build: string;
  at: number;
}

/** 페이지에서 도는 빌드(running)와 디스크 빌드(disk)가 다르면 다시 로드한다. 같은 disk로 RELOAD_GUARD_MS 안에 시도했으면 하지 않는다 */
export function shouldReload(running: string, disk: string | null, last: LastReload | undefined, now: number): boolean {
  if (disk === null || disk === running) return false;
  return !(last !== undefined && last.build === disk && now - last.at < RELOAD_GUARD_MS);
}

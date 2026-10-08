export interface LastReload {
  /** 다시 로드하게 만든 디스크 빌드 */
  build: string;
  /** 그때 페이지에서 돌던 빌드 */
  from: string;
  at: number;
}

/**
 * 페이지에서 도는 빌드(running)와 디스크 빌드(disk)가 다르면 다시 로드한다.
 * 같은 쌍(running → disk)으로 이미 다시 로드했는데 그대로라면 다시 하지 않는다 — 크롬이 새 파일을 못 올려도 탭이 끝없이 새로고침되지 않게.
 * 새 빌드가 나오면(disk가 바뀌면) 다시 시도한다
 */
export function shouldReload(running: string, disk: string | null, last: LastReload | undefined): boolean {
  if (disk === null || disk === running) return false;
  return !(last !== undefined && last.build === disk && last.from === running);
}

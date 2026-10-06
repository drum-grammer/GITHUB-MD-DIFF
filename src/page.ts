const PR_CHANGES = /^\/[^/]+\/[^/]+\/pull\/\d+\/(?:changes|files)(?:\/|$)/;
const PR_ROOT = /^\/[^/]+\/[^/]+\/pull\/\d+/;

/** PR "Files changed" 화면인가 (새 화면 /changes, 옛 주소 /files) */
export function isPrChangesPage(url: string): boolean {
  try {
    return PR_CHANGES.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** 파일 상태를 PR마다 따로 기억하기 위한 키. 파일 묶음 id(diff-<경로 해시>)는 PR이 달라도 같다 */
export function fileKey(url: string, fileId: string): string {
  const m = new URL(url).pathname.match(PR_ROOT);
  return `${m ? m[0] : ''}#${fileId}`;
}

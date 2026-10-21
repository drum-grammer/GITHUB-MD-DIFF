import type { RichStatus } from './autorich';
import type { PageStructure } from './selectors';

export type ProblemKey = 'problemNoRichButton' | 'problemNoProseDiff' | 'problemNoFiles';

export interface FileResult {
  key: string;
  status: RichStatus;
}

/** GitHub 화면을 읽었다는 뜻의 상태 — 렌더링 버튼을 찾았거나, 버튼 대신 GitHub의 안내 글(notice)을 봤다 */
const FOUND_BUTTON: ReadonlySet<RichStatus> = new Set<RichStatus>([
  'rich', 'clicked', 'waiting', 'queued', 'timeout', 'fallback', 'local', 'notice', 'idle', 'user-source', 'has-threads',
]);

/**
 * 배지에 올릴 문제. 렌더링이 확장이 모르는 모양으로 나온 파일(timeout)은 언제나 문제다.
 * GitHub가 렌더링을 못 만든 파일(fallback·local — 큰 파일의 504 등)은 GitHub 화면 변경이 아니므로 문제가 아니다.
 * 버튼이 없는 파일은 페이지의 어느 md 파일에서도 버튼을 못 찾았을 때만 문제다 — 그때는 GitHub 화면이 바뀐 것이고,
 * 다른 파일엔 있으면 그 파일만 렌더링 보기가 없는 것(이름만 바뀐 파일 등)이다.
 */
export function problemsFor(results: FileResult[]): Map<string, ProblemKey> {
  const anyButton = results.some((r) => FOUND_BUTTON.has(r.status));
  const out = new Map<string, ProblemKey>();
  for (const r of results) {
    if (r.status === 'timeout') out.set(r.key, 'problemNoProseDiff');
    else if (r.status === 'no-button' && !anyButton) out.set(r.key, 'problemNoRichButton');
  }
  return out;
}

/**
 * 화면에 파일이 있다는 신호(파일 링크)가 있는데 파일 묶음을 하나도 못 찾았거나, 찾은 파일의 이름을 하나도 못 읽었으면
 * GitHub가 화면 구조를 바꾼 것이다. 1.5.0은 이때 아무 말 없이 멈췄다(2026-10-14, 클래스 이름 형식 변경).
 * 뼈대(아직 안 온 파일)만 있으면 기다린다. content.ts는 이 상태가 몇 초 이어질 때만 알린다
 */
export function structureProblem(s: PageStructure): ProblemKey | null {
  if (s.links === 0) return null;
  if (s.files === 0) return 'problemNoFiles';
  if (s.named === 0 && s.loading < s.files) return 'problemNoFiles';
  return null;
}

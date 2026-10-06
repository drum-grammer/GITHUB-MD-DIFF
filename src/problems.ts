import type { RichStatus } from './autorich';

export type ProblemKey = 'problemNoRichButton' | 'problemNoProseDiff';

export interface FileResult {
  key: string;
  status: RichStatus;
}

/** 렌더링 버튼을 찾았다는 뜻의 상태 */
const FOUND_BUTTON: ReadonlySet<RichStatus> = new Set<RichStatus>([
  'rich', 'clicked', 'waiting', 'timeout', 'idle', 'user-source', 'has-threads',
]);

/**
 * 배지에 올릴 문제. 렌더링이 시간 안에 안 나온 파일은 언제나 문제다.
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

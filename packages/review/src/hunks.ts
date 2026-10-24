// 보류 중 리뷰에 넣기 전 줄 맞추기(스펙 §6-3) — GitHub는 PR diff의 hunk 안 줄에만 줄 코멘트를 받는다(밖이면 422, ⚠️ 사용자 보고).
// 오류 문구에 기대지 않고, GitHub가 준 patch(pulls/<n>/files)의 hunk로 미리 맞춘다. 로컬 git diff의 hunk는 사용자 설정에 따라 다를 수 있다
import { lineLabel } from './handoff';
import { fenced, splitSuggestion } from './quote';
import type { Draft, SourceSide } from './records';

/** hunk 하나가 덮는 줄(1부터, 끝 포함) — 그 쪽 줄이 없으면 null */
export interface Hunk {
  left: [number, number] | null;
  right: [number, number] | null;
}

const span = (start: number, count: number): [number, number] | null => (count > 0 ? [start, start + count - 1] : null);

/** unified diff의 @@ 머리만 읽는다. 개수를 생략하면 1이다 */
export function parsePatch(patch: string): Hunk[] {
  const out: Hunk[] = [];
  for (const m of patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    out.push({ left: span(Number(m[1]), m[2] === undefined ? 1 : Number(m[2])), right: span(Number(m[3]), m[4] === undefined ? 1 : Number(m[4])) });
  }
  return out;
}

/** 그 쪽 범위와 겹침이 가장 긴 hunk 하나와의 겹침(같으면 앞 hunk). GitHub는 여러 줄 코멘트의 처음과 끝이 한 hunk 안이어야 받는다 */
export function fitRange(hunks: Hunk[], side: SourceSide, start: number, end: number): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (const h of hunks) {
    const r = side === 'old' ? h.left : h.right;
    if (!r) continue;
    const s = Math.max(start, r[0]);
    const e = Math.min(end, r[1]);
    if (s > e) continue;
    if (!best || e - s > best.end - best.start) best = { start: s, end: e };
  }
  return best;
}

/** patch가 null이면 GitHub가 diff를 주지 않은 큰 파일이다 */
export interface PrFileInfo {
  path: string;
  patch: string | null;
  /** GitHub가 이름 바꿈으로 본 파일의 옛 경로 */
  previous?: string;
}

/** 그 초안의 GitHub 파일 — git은 지움+추가로 봤는데 GitHub는 이름 바꿈으로 봤으면, 옛 경로의 옛 쪽 초안은 새 경로의 옛 쪽이다 */
function fileFor(files: Map<string, PrFileInfo>, d: Draft): PrFileInfo | undefined {
  return files.get(d.path) ?? (d.side === 'old' ? [...files.values()].find((f) => f.previous === d.path) : undefined);
}

export type UploadItem =
  | { draft: string; kind: 'line'; path: string; side: 'LEFT' | 'RIGHT'; start: number; end: number; body: string }
  | { draft: string; kind: 'file'; path: string; body: string }
  | { draft: string; kind: 'reply'; thread: string; body: string }
  | { draft: string; kind: 'error'; error: string };

const MAX_QUOTE_LINES = 20;

const label = (side: SourceSide, start: number, end: number): string => `\`${lineLabel(start, end)}${side === 'old' ? ' (old)' : ''}\``;

/** 인용은 펜스 안에 — `> `로 두면 원문 속 @이름·#번호가 리뷰를 제출할 때 알림·링크가 된다 */
function quoteBlock(quote: string): string {
  const lines = quote.split('\n');
  const shown = lines.slice(0, MAX_QUOTE_LINES);
  if (lines.length > MAX_QUOTE_LINES) shown.push('…');
  return fenced(shown.join('\n'));
}

/** 줄이 바뀌면 제안 블록이 다른 줄에 적용된다 — 적용되지 않는 text 펜스로 바꾼다 */
function demoteSuggestion(body: string, where: string): string {
  const split = splitSuggestion(body);
  if (split.suggestion === null) return body;
  return [split.body, `Suggested replacement for ${where}:\n${fenced(split.suggestion, 'text')}`].filter(Boolean).join('\n\n');
}

/** 초안 → 올릴 항목(초안 순서 그대로). 줄이 hunk에 다 들어가면 글 그대로, 일부면 잘라서 원래 줄을 앞에, 겹침이 없거나 diff가 없는 파일이면 인용을 붙여 파일 스레드로 */
export function planUpload(drafts: Draft[], files: Map<string, PrFileInfo>): UploadItem[] {
  return drafts.map((d): UploadItem => {
    if (d.replyTo) return { draft: d.id, kind: 'reply', thread: d.replyTo, body: d.body };
    const file = fileFor(files, d);
    if (!file) return { draft: d.id, kind: 'error', error: `${d.path} is not among the changed files of the pull request` };
    const where = label(d.side, d.start, d.end);
    const fit = file.patch === null ? null : fitRange(parsePatch(file.patch), d.side, d.start, d.end);
    if (!fit) {
      const why = file.patch === null ? 'GitHub shows no diff for this file, so the comment is on the whole file' : 'unchanged lines; GitHub accepts line comments only on changed lines';
      return { draft: d.id, kind: 'file', path: file.path, body: `${where} (${why})\n\n${quoteBlock(d.quote)}\n\n${demoteSuggestion(d.body, where)}` };
    }
    const side = d.side === 'old' ? 'LEFT' : 'RIGHT';
    if (fit.start === d.start && fit.end === d.end) return { draft: d.id, kind: 'line', path: file.path, side, start: d.start, end: d.end, body: d.body };
    const body = `${where} — trimmed to ${label(d.side, fit.start, fit.end)}, the changed lines GitHub accepts\n\n${demoteSuggestion(d.body, where)}`;
    return { draft: d.id, kind: 'line', path: file.path, side, start: fit.start, end: fit.end, body };
  });
}

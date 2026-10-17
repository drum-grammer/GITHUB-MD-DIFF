/** 원문 줄 비교 — 빈 줄만 바뀐 곳(whitespace 알림), 줄 끝만 바뀐 파일(line-endings 알림), "원문만 바뀜" 막대의 줄 diff */
import { diffArrays } from 'diff';
import { INVISIBLE } from './keys';
import type { Range } from './types';

export type LineOp = { op: 'same' | 'del' | 'ins'; line: string };

/** 줄 단위 diff(Myers, diff 패키지) */
export function lineOps(oldLines: string[], newLines: string[]): LineOp[] {
  const out: LineOp[] = [];
  for (const c of diffArrays(oldLines, newLines)) {
    const op = c.added ? 'ins' : c.removed ? 'del' : 'same';
    for (const line of c.value) out.push({ op, line });
  }
  return out;
}

export interface Hunk {
  /** 지운 줄(옛 쪽). 없으면 undefined */
  old?: Range;
  /** 넣은 줄(새 쪽). 없으면 undefined */
  new?: Range;
  oldLines: string[];
  newLines: string[];
}

/** 바뀐 덩어리 — 이어진 지움·넣음을 하나로 */
export function hunks(oldLines: string[], newLines: string[]): Hunk[] {
  const out: Hunk[] = [];
  let o = 1;
  let n = 1;
  let cur: Hunk | null = null;
  for (const c of diffArrays(oldLines, newLines)) {
    if (!c.added && !c.removed) {
      cur = null;
      o += c.count ?? c.value.length;
      n += c.count ?? c.value.length;
      continue;
    }
    cur ??= out[out.push({ oldLines: [], newLines: [] }) - 1];
    if (c.removed) {
      cur.old = { start: o, end: o + c.value.length - 1 };
      cur.oldLines.push(...c.value);
      o += c.value.length;
    } else {
      cur.new = { start: n, end: n + c.value.length - 1 };
      cur.newLines.push(...c.value);
      n += c.value.length;
    }
  }
  return out;
}

/** 줄 끝 정규화(CRLF·CR → LF)와 줄 끝 공백 지우기 — 이 둘만 다르면 렌더링 diff 대신 파일 알림 하나 */
export function eolCanon(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n');
}

/** 줄 끝 모양(CR 개수) — 다르면 모든 줄이 git hunk가 된다 */
export function eolStyle(text: string): number {
  return (text.match(/\r/g) ?? []).length;
}

/** 보이지 않는 글자를 ⟦U+200B⟧처럼 보이게 */
export function showInvisible(line: string): string {
  return line.replace(INVISIBLE, (c) => `⟦U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}⟧`);
}

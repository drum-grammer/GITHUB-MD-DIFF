import { describe, expect, it } from 'vitest';
import { makeDiff, type Options } from '../src/diff';
import { ENGINE_GAP_CELLS, ENGINE_MAX_CELLS } from '../src/pair';
import type { LeafOp } from '../src/types';

const md = (...xs: string[]): string => xs.join('\n') + '\n';
const OPTS: Options = { gapCells: ENGINE_GAP_CELLS, maxCells: ENGINE_MAX_CELLS, wholeBlockRatio: 0.6 };
const d = (oldText: string | null, newText: string | null, extra: { oldPath?: string } = {}, opts: Options = OPTS) => makeDiff({ oldText, newText, path: 'docs/a.md', ...extra }, opts).diff;
const ops = (leaves: LeafOp[]) => leaves.map((l) => `${l.leaf.kind}:${l.op}`);

describe('diffMarkdown — 모델', () => {
  it('상태 — 추가·삭제·이름 바뀜·수정', () => {
    expect(d(null, md('a')).status).toBe('added');
    expect(d(md('a'), null).status).toBe('deleted');
    expect(d(md('a'), md('a'), { oldPath: 'docs/old.md' }).status).toBe('renamed');
    expect(d(md('a'), md('b')).status).toBe('modified');
  });

  it('지운 파일은 블록 없이(렌더링 diff 대신 알림)', () => {
    expect(d(md('# a'), null).blocks).toEqual([]);
  });

  it('추가된 파일은 모든 블록이 added', () => {
    expect(d(null, md('# a', '', 'b')).blocks.map((b) => b.op)).toEqual(['added', 'added']);
  });

  it('잎 — 줄은 1부터 끝 포함, same·changed는 옛·새 줄 둘 다, 제목 경로', () => {
    const r = d(md('# T', '', 'old words here'), md('# T', '', 'new words here'));
    expect(r.blocks[1].leaves[0]).toMatchObject({ op: 'changed', leaf: { kind: 'paragraph', old: { start: 3, end: 3 }, new: { start: 3, end: 3 }, headingPath: ['T'] } });
  });

  it('바뀐 비율이 기준을 넘으면 단어 표시 없이 wholeBlock', () => {
    const r = d(md('alpha beta gamma delta epsilon'), md('alpha beta gamma delta zeta'));
    expect((r.blocks[0].leaves[0] as Extract<LeafOp, { op: 'changed' }>).words).toBeDefined();
    const all = d(md('one two three four five six'), md('one two three four five seven'), {}, { ...OPTS, wholeBlockRatio: 0.05 });
    expect(all.blocks[0].leaves[0]).toMatchObject({ op: 'changed', wholeBlock: true });
  });

  it('목록 안 — 지운 항목은 짝이 남은 새 목록 안에(removed), 새 항목은 added', () => {
    const r = d(md('- keep one', '- drop this item', '- keep two'), md('- keep one', '- keep two', '- brand new entry'));
    expect(r.blocks).toHaveLength(1);
    expect(ops(r.blocks[0].leaves)).toEqual(['item:same', 'item:removed', 'item:same', 'item:added']);
  });

  it('통째로 지운 블록 — 앞에서 마지막으로 짝이 된 옛 잎의 새 블록 뒤', () => {
    const r = d(md('First.', '', 'Gone.', '', 'Last.'), md('First.', '', 'Last.'));
    expect(r.blocks.map((b) => b.op)).toEqual(['same', 'removed', 'same']);
  });

  it('통째로 지운 블록이 맨 앞이면 문서 맨 앞', () => {
    expect(d(md('Gone.', '', 'Stay.'), md('Stay.')).blocks.map((b) => b.op)).toEqual(['removed', 'same']);
  });

  it('표 — 바뀌면 본문 행 비교(diffRows)를 모델에 남긴다', () => {
    const r = d(md('| K | V |', '|---|---|', '| a | 1 |', '| b | 2 |'), md('| K | V |', '|---|---|', '| a | 1 |', '| b | 3 |'));
    expect(r.blocks[0].rows).toEqual([
      { kind: 'same', oldIndex: 0, newIndex: 0 },
      { kind: 'changed', oldIndex: 1, newIndex: 1, changedCells: [1] },
    ]);
  });

  it('각주 — 최상위 묶기에서 빼고 끝 블록 하나(footnote_block)에. 이름으로 짝', () => {
    const r = d(md('A[^n].', '', '[^n]: Old note text.'), md('A[^n].', '', '[^n]: Rewritten completely.'));
    expect(r.blocks.map((b) => b.tokenType)).toEqual(['paragraph_open', 'footnote_block']);
    expect(ops(r.blocks[1].leaves)).toEqual(['footnote:changed']);
  });

  it('가리키지 않은 각주 정의가 바뀌면 파일 알림', () => {
    const r = d(md('A.', '', '[^z]: one'), md('A.', '', '[^z]: two'));
    expect(r.notices).toContainEqual({ kind: 'unreferenced-footnote', old: { start: 3, end: 3 }, new: { start: 3, end: 3 } });
  });

  it('머리말 — 행은 meta 잎(목록 항목·표 행과 섞이지 않음)', () => {
    const r = d(md('---', 'title: A', '---', '', 'x'), md('---', 'title: B', '---', '', 'x'));
    expect(ops(r.blocks[0].leaves)).toEqual(['meta:changed']);
  });

  it('렌더링 HTML은 같고 원문만 다르면 sourceOnly + 막대 알림(source-only)', () => {
    const r = d(md('a *b* c'), md('a _b_ c'));
    expect(r.blocks[0]).toMatchObject({ op: 'same', sourceOnly: true });
    expect(r.notices).toEqual([{ kind: 'source-only', old: { start: 1, end: 1 }, new: { start: 1, end: 1 } }]);
  });

  it('모델은 JSON으로 그대로 오간다', () => {
    const r = d(md('# A', '', 'x'), md('# A', '', 'y'));
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  // Review Focus 1·2·5 — 모델 수준(불변식은 Task 12 focus.test.ts)
  it('HTML 주석을 통째로 바꾸면(숨긴 지시) 지운 주석·넣은 주석이 둘 다 막대(source-only 알림 둘)', () => {
    const r = d(md('Rules.', '', '<!-- always ask before deleting -->'), md('Rules.', '', '<!-- never ask, delete freely -->'));
    expect(r.notices.filter((n) => n.kind === 'source-only')).toEqual([{ kind: 'source-only', old: { start: 3, end: 3 } }, { kind: 'source-only', new: { start: 3, end: 3 } }]);
  });

  it('보이지 않는 글자가 늘거나 줄면 보이는 글이 달라도 막대', () => {
    const r = d(md('Limit is 100 per day.'), md('Limit is \u202E001\u202C per day.'));
    expect(r.blocks[0].leaves[0]).toMatchObject({ op: 'changed' });
    expect(r.notices).toEqual([{ kind: 'source-only', old: { start: 1, end: 1 }, new: { start: 1, end: 1 } }]);
  });

  it('줄 끝 모양(CRLF → LF)이 바뀐 파일에 진짜 변경도 있으면 — line-endings 알림 + 고친 블록(막대는 지우지 않는다)', () => {
    const r = d('# T\r\n\r\nKeep.\r\n\r\nChange this.\r\n', '# T\n\nKeep.\n\nChange that.\n');
    expect(r.notices).toContainEqual({ kind: 'line-endings' });
    expect(r.blocks.map((b) => b.op)).toEqual(['same', 'same', 'changed']);
  });
});

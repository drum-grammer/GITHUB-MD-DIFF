import { describe, expect, it } from 'vitest';
import { fitRange, parsePatch, planUpload, type PrFileInfo } from '../src/hunks';
import type { Draft } from '../src/records';

const draft = (over: Partial<Draft>): Draft => ({
  id: 'd00000001',
  rev: 'rabcde',
  path: 'docs/a.md',
  side: 'new',
  start: 3,
  end: 3,
  body: 'Please shorten.',
  kind: 'paragraph',
  headingPath: [],
  quote: 'line three',
  quoteSanitized: 'line three',
  createdAt: '2026-10-23T10:00:00+09:00',
  updatedAt: '2026-10-23T10:00:00+09:00',
  scope: 'pr:acme/docs#7',
  ...over,
});
const files = (entries: Record<string, string | null>): Map<string, PrFileInfo> => new Map(Object.entries(entries).map(([path, patch]) => [path, { path, patch }]));
// 새 쪽 1–3줄과 20–29줄, 옛 쪽 1–3줄과 20–29줄이 GitHub가 받는 줄이다
const PATCH = '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -20,10 +20,10 @@ x\n';

describe('parsePatch · fitRange', () => {
  it('parsePatch — @@ -3,4 +3,6 @@, @@ -0,0 +1,2 @@(새 파일), @@ -5 +5 @@', () => {
    expect(parsePatch('@@ -3,4 +3,6 @@ x\n a\n-b\n+c\n@@ -0,0 +1,2 @@\n+n\n+m\n@@ -5 +5 @@\n-p\n+q')).toEqual([
      { left: [3, 6], right: [3, 8] },
      { left: null, right: [1, 2] },
      { left: [5, 5], right: [5, 5] },
    ]);
    expect(parsePatch('')).toEqual([]);
  });

  it('fitRange — 두 hunk에 걸치면 겹침이 큰 쪽, 겹침 없으면 null', () => {
    const h = parsePatch('@@ -1,3 +1,3 @@\n@@ -20,10 +20,10 @@');
    expect(fitRange(h, 'new', 2, 25)).toEqual({ start: 20, end: 25 });
    expect(fitRange(h, 'new', 8, 12)).toBeNull();
    expect(fitRange(h, 'old', 21, 22)).toEqual({ start: 21, end: 22 });
    expect(fitRange(h, 'new', 2, 21)).toEqual({ start: 2, end: 3 });
    expect(fitRange(parsePatch('@@ -0,0 +1,2 @@'), 'old', 1, 1)).toBeNull();
  });
});

describe('planUpload — 이름 바꿈', () => {
  it('git은 지움+추가로, GitHub는 이름 바꿈으로 본 파일 — 옛 경로의 옛 쪽 초안은 새 경로의 LEFT로', () => {
    const files = new Map<string, PrFileInfo>([['docs/new.md', { path: 'docs/new.md', patch: '@@ -2,3 +2,3 @@', previous: 'docs/old.md' }]]);
    expect(planUpload([draft({ id: 'd1', path: 'docs/old.md', side: 'old', start: 3, end: 3, body: 'why removed?' })], files)).toEqual([
      { draft: 'd1', kind: 'line', path: 'docs/new.md', side: 'LEFT', start: 3, end: 3, body: 'why removed?' },
    ]);
    // 새 쪽 초안이 옛 경로를 가리키지는 않는다 — PR 밖 그대로
    expect(planUpload([draft({ id: 'd2', path: 'docs/old.md', side: 'new' })], files)[0]).toMatchObject({ kind: 'error' });
  });
});

describe('planUpload', () => {
  it('맞으면 글 그대로, 잘리면 원래 줄, 접힌 블록이면 인용 붙인 파일 스레드', () => {
    const items = planUpload(
      [
        draft({ id: 'd1', start: 2, end: 3 }),
        draft({ id: 'd2', start: 2, end: 25 }),
        draft({ id: 'd3', start: 8, end: 9, quote: 'eight\n\nnine', body: 'Why is this here?' }),
      ],
      files({ 'docs/a.md': PATCH }),
    );
    expect(items).toEqual([
      { draft: 'd1', kind: 'line', path: 'docs/a.md', side: 'RIGHT', start: 2, end: 3, body: 'Please shorten.' },
      { draft: 'd2', kind: 'line', path: 'docs/a.md', side: 'RIGHT', start: 20, end: 25, body: '`L2–25` — trimmed to `L20–25`, the changed lines GitHub accepts\n\nPlease shorten.' },
      { draft: 'd3', kind: 'file', path: 'docs/a.md', body: '`L8–9` (unchanged lines; GitHub accepts line comments only on changed lines)\n\n```text\neight\n\nnine\n```\n\nWhy is this here?' },
    ]);
  });

  it('인용은 20줄까지, 펜스 안에 — 원문 속 @이름·#번호가 제출 때 알림·링크가 되지 않게', () => {
    const quote = ['Ask @alice about #12', ...Array.from({ length: 24 }, (_, i) => `q${i + 2}`)].join('\n');
    const [item] = planUpload([draft({ start: 5, end: 15, quote })], files({ 'docs/a.md': PATCH }));
    expect(item.kind).toBe('file');
    const body = (item as { body: string }).body;
    expect(body).toContain('```text\nAsk @alice about #12\nq2\n');
    expect(body).toContain('q20\n…\n```\n\nPlease shorten.');
    expect(body).not.toMatch(/^> /m);
    expect(body).not.toContain('q21');
  });

  it('제안 블록은 줄이 바뀌면 text 펜스로, 맞으면 그대로', () => {
    const body = 'Use this:\n\n```suggestion\nBetter line\n```';
    const [fits, moved] = planUpload([draft({ id: 'd1', start: 2, end: 2, body }), draft({ id: 'd2', start: 2, end: 25, body })], files({ 'docs/a.md': PATCH }));
    expect(fits).toMatchObject({ kind: 'line', body });
    expect(moved).toMatchObject({
      kind: 'line',
      start: 20,
      end: 25,
      body: '`L2–25` — trimmed to `L20–25`, the changed lines GitHub accepts\n\nUse this:\n\nSuggested replacement for `L2–25`:\n```text\nBetter line\n```',
    });
  });

  it('patch 없는 큰 파일은 모두 파일 스레드, 옛 쪽은 LEFT, 답글은 reply, PR 밖 경로는 error', () => {
    const items = planUpload(
      [
        draft({ id: 'd1', path: 'docs/big.md', start: 2, end: 2, quote: 'two' }),
        draft({ id: 'd2', side: 'old', start: 21, end: 21 }),
        draft({ id: 'd3', replyTo: 'PRRT_abc', body: 'Agreed.' }),
        draft({ id: 'd4', path: 'docs/other.md' }),
        draft({ id: 'd5', side: 'old', start: 8, end: 8, quote: 'old eight' }),
      ],
      files({ 'docs/a.md': PATCH, 'docs/big.md': null }),
    );
    expect(items).toEqual([
      { draft: 'd1', kind: 'file', path: 'docs/big.md', body: '`L2` (GitHub shows no diff for this file, so the comment is on the whole file)\n\n```text\ntwo\n```\n\nPlease shorten.' },
      { draft: 'd2', kind: 'line', path: 'docs/a.md', side: 'LEFT', start: 21, end: 21, body: 'Please shorten.' },
      { draft: 'd3', kind: 'reply', thread: 'PRRT_abc', body: 'Agreed.' },
      { draft: 'd4', kind: 'error', error: 'docs/other.md is not among the changed files of the pull request' },
      { draft: 'd5', kind: 'file', path: 'docs/a.md', body: '`L8 (old)` (unchanged lines; GitHub accepts line comments only on changed lines)\n\n```text\nold eight\n```\n\nPlease shorten.' },
    ]);
  });
});

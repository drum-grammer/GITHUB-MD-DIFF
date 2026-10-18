import { existsSync, readdirSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Draft, RenderRecord, Round } from '../src/records';
import { StateStore, stateDirFor } from '../src/state';
import { tempDir } from './helpers/git-repo';

function store(): StateStore {
  const base = tempDir('mdc-state-');
  const root = tempDir('mdc-wt-');
  const s = new StateStore(base, stateDirFor(base, { root, commonDir: join(root, '.git') }), root);
  s.ensure('1.5.1');
  return s;
}
const render = (id: string): RenderRecord => ({ id, createdAt: '2026-10-16T14:00:00+09:00', mode: 'worktree', baseOid: 'a'.repeat(40), baseLabel: 'merge-base main', view: { kind: 'merge-base' }, files: { 'a.md': 'x\n', 'gone.md': null }, shown: ['a.md', 'gone.md'] });
const draft = (id: string, rev: string): Draft => ({ id, rev, path: 'a.md', side: 'new', start: 1, end: 1, body: 'b', kind: 'paragraph', headingPath: [], quote: 'x', quoteSanitized: 'x', createdAt: '2026-10-16T14:00:00+09:00', updatedAt: '2026-10-16T14:00:00+09:00' });
const round = (n: number, rev: string): Round => ({ round: n, createdAt: `2026-10-16T14:0${n}:00+09:00`, rev, mode: 'worktree', base: { kind: 'merge-base', oid: 'a'.repeat(40), label: 'merge-base main' }, changedAfterRender: false, files: ['a.md'], comments: [] });

describe('렌더 판', () => {
  it('id는 r + 5자이고 겹치지 않는다', () => {
    const s = store();
    const ids = new Set(Array.from({ length: 50 }, () => s.newRenderId()));
    for (const id of ids) expect(id).toMatch(/^r[0-9a-z]{5}$/);
    expect(ids.size).toBe(50);
  });
  it('저장·읽기(지운 파일은 null), 경로를 흉내 낸 id는 읽지 않는다', () => {
    const s = store();
    s.saveRender(render('r00001'));
    expect(s.loadRender('r00001')).toEqual(render('r00001'));
    expect(statSync(s.file('renders/r00001.json')).mode & 0o777).toBe(0o600);
    expect(s.loadRender('../server')).toBeNull();
    expect(s.loadRender('r99999')).toBeNull();
  });
  it('라운드(코멘트 판 포함)·마지막 mark·초안·지금 판은 남기고, 나머지는 최근 20개만', () => {
    const s = store();
    const old = new Date(Date.now() - 3_600_000);
    for (const id of ['rround', 'rcomms', 'rmark0', 'rmark1', 'rdraft', 'rcurnt']) {
      s.saveRender(render(id));
      utimesSync(s.file(`renders/${id}.json`), old, old);
    }
    for (let i = 0; i < 25; i++) {
      const id = `r${String(i).padStart(5, '0')}`;
      s.saveRender(render(id));
      const t = new Date(Date.now() - (25 - i) * 1000);
      utimesSync(s.file(`renders/${id}.json`), t, t);
    }
    s.saveRound({ ...round(1, 'rround'), comments: [{ id: 'c1', round: 1, rev: 'rcomms', path: 'a.md', side: 'new', start: 1, end: 1, kind: 'paragraph', headingPath: [], author: 'you', quote: 'x', quoteSanitized: 'x', body: 'b', suggestion: null, base: 'a'.repeat(40), mode: 'worktree', createdAt: '' }] }, '');
    s.addMark('rmark0', '2026-10-16T14:00:00+09:00');
    s.addMark('rmark1', '2026-10-16T14:01:00+09:00');
    s.saveDrafts([draft('d00000001', 'rdraft')]);
    const gone = s.pruneRenders(20, ['rcurnt']);
    expect(gone.sort()).toEqual(['r00000', 'r00001', 'r00002', 'r00003', 'r00004', 'rmark0']);
    const left = s.renderIds();
    for (const id of ['rround', 'rcomms', 'rmark1', 'rdraft', 'rcurnt', 'r00005', 'r00024']) expect(left).toContain(id);
  });
});

describe('초안·라운드·넘김·mark', () => {
  it('초안을 저장하고 다시 읽는다', () => {
    const s = store();
    expect(s.drafts()).toEqual([]);
    s.saveDrafts([draft('d00000001', 'r00001')]);
    expect(s.drafts().map((d) => d.id)).toEqual(['d00000001']);
  });
  it('라운드 번호는 worktree마다 1씩 늘고, 정본 .json과 넘기기 .md를 남긴다', () => {
    const s = store();
    expect(s.nextRoundNumber()).toBe(1);
    const path = s.saveRound(round(1, 'r00001'), '# one\n');
    expect(path).toBe(s.file('rounds/0001-20261016T140100.json'));
    s.saveRound(round(2, 'r00002'), '# two\n');
    expect(s.nextRoundNumber()).toBe(3);
    expect(s.rounds().map((r) => r.round)).toEqual([1, 2]);
    expect(readdirSync(s.file('rounds')).sort()).toEqual(['0001-20261016T140100.json', '0001-20261016T140100.md', '0002-20261016T140200.json', '0002-20261016T140200.md']);
  });
  it('넘긴 라운드 번호를 겹치지 않게 모은다', () => {
    const s = store();
    s.markDelivered([2, 1]);
    s.markDelivered([2, 3]);
    expect(s.delivered()).toEqual([1, 2, 3]);
  });
  it('mark는 있는 판만 — 없으면 review로 다시 그리라고 안내한다', () => {
    const s = store();
    expect(() => s.addMark('rnope1', 'now')).toThrow('run markdown-diff-cat review to draw the files again');
    s.saveRender(render('r00001'));
    expect(s.addMark('r00001', '2026-10-16T15:00:00+09:00')).toEqual({ rev: 'r00001', at: '2026-10-16T15:00:00+09:00' });
    expect(s.marks()).toHaveLength(1);
    expect(existsSync(s.file('marks.json'))).toBe(true);
  });
});

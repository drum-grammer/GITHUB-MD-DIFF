import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { repoInfo, resolveBase } from '../src/git';
import type { Mark, RenderRecord, Round } from '../src/records';
import { fingerprint, latestBaseline, sinceLastFiles, snapshot } from '../src/views';
import { tempDir, tempRepo, type TempRepo } from './helpers/git-repo';

const made: TempRepo[] = [];
const repo = (): TempRepo => {
  const r = tempRepo();
  made.push(r);
  return r;
};
afterEach(() => {
  for (const r of made.splice(0)) r.cleanup();
});
const baseOf = (r: TempRepo): string => resolveBase(repoInfo(r.dir)).oid;
/** 지금 상태를 렌더 판처럼 남긴다 */
const renderNow = (r: TempRepo, id: string): RenderRecord => {
  const baseOid = baseOf(r);
  const snap = snapshot(r.dir, baseOid);
  return { id, createdAt: '2026-10-16T14:00:00+09:00', mode: 'worktree', baseOid, baseLabel: 'merge-base main', view: { kind: 'merge-base' }, files: snap.files, shown: snap.viewFiles.map((f) => f.path) };
};
const paths = (files: Array<{ path: string; status: string }>): string[] => files.map((f) => `${f.status} ${f.path}`);

describe('snapshot — 분기점 보기와 렌더 판에 담을 원문', () => {
  it('수정·추가·삭제·이름 바꿈 — 판에는 지운 경로와 이름 바꾼 옛 경로가 null로 남는다', () => {
    const r = repo();
    r.write('a.md', 'a1\n');
    r.write('gone.md', 'g\n');
    r.write('old.md', 'Line 1 about moving.\nLine 2 about moving.\nLine 3 about moving.\n');
    r.commit();
    r.write('a.md', 'a2\n');
    r.write('new.md', 'n\n');
    r.remove('gone.md');
    r.git('mv', 'old.md', 'moved.md');
    const snap = snapshot(r.dir, baseOf(r));
    expect(snap.files).toEqual({ 'a.md': 'a2\n', 'gone.md': null, 'old.md': null, 'moved.md': 'Line 1 about moving.\nLine 2 about moving.\nLine 3 about moving.\n', 'new.md': 'n\n' });
    expect(paths(snap.viewFiles)).toEqual(['modified a.md', 'deleted gone.md', 'renamed moved.md', 'added new.md']);
    const moved = snap.viewFiles.find((f) => f.path === 'moved.md')!;
    expect(moved.oldPath).toBe('old.md');
    expect(moved.oldText).toBe(moved.newText);
    expect(snap.viewFiles.find((f) => f.path === 'a.md')).toMatchObject({ oldText: 'a1\n', newText: 'a2\n' });
  });
  it('저장소 밖을 가리키는 심링크 md는 내용이 아니라 링크 글자로 담는다(비밀이 판·화면에 실리지 않게)', () => {
    const r = repo();
    r.write('a.md', 'a\n');
    r.commit();
    const secret = join(tempDir(), 'secret.md');
    writeFileSync(secret, 'TOKEN=abc\n');
    symlinkSync(secret, join(r.dir, 'notes.md'));
    const snap = snapshot(r.dir, baseOf(r));
    expect(snap.files['notes.md']).toBe(secret);
    expect(JSON.stringify(snap)).not.toContain('TOKEN=abc');
    expect(snap.skipped).toEqual([]);
  });
});

describe('sinceLastFiles — 지난 리뷰 이후(스펙 §5-4)', () => {
  it('판 이후 바뀐 파일만, 옛 쪽은 판의 원문 — 판에 없던 파일은 판의 기준 OID 원문', () => {
    const r = repo();
    r.write('a.md', 'a0\n');
    r.write('b.md', 'b0\n');
    r.write('d.md', 'd0\n');
    r.commit();
    r.write('a.md', 'a1\n');
    r.write('b.md', 'b1\n');
    const r1 = renderNow(r, 'r00001');
    r.write('a.md', 'a2\n');
    r.write('c.md', 'c\n');
    r.write('d.md', 'd1\n');
    const files = sinceLastFiles(r.dir, r1, snapshot(r.dir, baseOf(r)));
    expect(paths(files)).toEqual(['modified a.md', 'added c.md', 'modified d.md']);
    expect(files[0]).toMatchObject({ oldText: 'a1\n', newText: 'a2\n' });
    expect(files[2]).toMatchObject({ oldText: 'd0\n', newText: 'd1\n' });
  });
  it('연속 세 라운드 — 가운데 라운드에서 안 고친 파일의 옛 변경이 다시 뜨지 않는다', () => {
    const r = repo();
    r.write('a.md', 'a0\n');
    r.write('b.md', 'b0\n');
    r.commit();
    r.write('a.md', 'a1\n');
    r.write('b.md', 'b1\n');
    const r1 = renderNow(r, 'r00001'); // 라운드 1(분기점 보기)
    r.write('a.md', 'a2\n');
    expect(paths(sinceLastFiles(r.dir, r1, snapshot(r.dir, baseOf(r))))).toEqual(['modified a.md']);
    const r2 = renderNow(r, 'r00002'); // 라운드 2(지난 리뷰 이후 보기로 그린 판도 모든 md를 담는다)
    expect(Object.keys(r2.files).sort()).toEqual(['a.md', 'b.md']);
    r.write('c.md', 'c\n');
    expect(paths(sinceLastFiles(r.dir, r2, snapshot(r.dir, baseOf(r))))).toEqual(['added c.md']);
  });
  it('되돌려서 분기점과 같아진 파일은 지금 작업 트리 원문을 새 쪽으로 쓴다', () => {
    const r = repo();
    r.write('a.md', 'a0\n');
    r.commit();
    r.write('a.md', 'a1\n');
    const r1 = renderNow(r, 'r00001');
    r.write('a.md', 'a0\n');
    expect(sinceLastFiles(r.dir, r1, snapshot(r.dir, baseOf(r)))).toEqual([{ path: 'a.md', status: 'modified', oldText: 'a1\n', newText: 'a0\n' }]);
  });
  it('판 이후 그냥 mv한 파일은 이름 바꿈으로 짝짓는다', () => {
    const r = repo();
    const text = 'Line 1 about moving.\nLine 2 about moving.\nLine 3 about moving.\n';
    r.write('keep.md', 'k\n');
    r.commit();
    r.write('draft.md', text);
    const r1 = renderNow(r, 'r00001');
    r.remove('draft.md');
    r.write('final.md', text);
    expect(sinceLastFiles(r.dir, r1, snapshot(r.dir, baseOf(r)))).toEqual([{ path: 'final.md', oldPath: 'draft.md', status: 'renamed', oldText: text, newText: text }]);
  });
});

describe('latestBaseline', () => {
  const round = (rev: string, at: string): Round => ({ round: 1, createdAt: at, rev, mode: 'worktree', base: { kind: 'review-render', rev: 'r0' }, changedAfterRender: false, files: [], comments: [] });
  it('마지막 라운드와 마지막 mark 중 나중 것', () => {
    const marks: Mark[] = [{ rev: 'rmark1', at: '2026-10-16T15:00:00+09:00' }];
    expect(latestBaseline([round('rround', '2026-10-16T14:00:00+09:00')], marks)).toEqual({ rev: 'rmark1', at: '2026-10-16T15:00:00+09:00', source: 'mark' });
    expect(latestBaseline([round('rround', '2026-10-16T16:00:00+09:00')], marks)?.rev).toBe('rround');
    expect(latestBaseline([], [])).toBeNull();
  });
});

describe('fingerprint', () => {
  it('파일을 고치거나 새 md가 생기면 바뀌고, 그대로면 같다', () => {
    const r = repo();
    r.write('a.md', 'a\n');
    r.commit();
    r.write('a.md', 'b\n');
    const oid = baseOf(r);
    const first = fingerprint(r.dir, oid);
    expect(fingerprint(r.dir, oid)).toBe(first);
    r.write('a.md', 'b changed\n');
    const second = fingerprint(r.dir, oid);
    expect(second).not.toBe(first);
    r.write('new.md', 'n\n');
    expect(fingerprint(r.dir, oid)).not.toBe(second);
  });
});

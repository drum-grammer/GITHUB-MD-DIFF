import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitError, repoInfo, resolveBase } from '../src/git';
import { cloneOf, tempDir, tempRepo, type TempRepo } from './helpers/git-repo';

const made: TempRepo[] = [];
const keep = (r: TempRepo): TempRepo => (made.push(r), r);
afterEach(() => {
  // 나중에 만든 것부터(연결 worktree를 본 저장소보다 먼저)
  for (const r of made.splice(0).reverse()) r.cleanup();
});

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof GitError) return e.code;
    throw e;
  }
  return 'no error';
};
const SHA1_EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

describe('repoInfo', () => {
  it('git 저장소가 아니면 not-a-repo', () => {
    expect(codeOf(() => repoInfo(tempDir()))).toBe('not-a-repo');
  });
  it('bare 저장소면 bare', () => {
    const r = keep(tempRepo({ bare: true }));
    expect(codeOf(() => repoInfo(r.dir))).toBe('bare');
  });
  it('하위 폴더에서도 작업 트리 최상위와 공통 git 폴더(realpath)를 낸다', () => {
    const r = keep(tempRepo());
    r.write('a.md', 'x\n');
    const head = r.commit();
    mkdirSync(join(r.dir, 'sub'));
    const info = repoInfo(join(r.dir, 'sub'));
    expect(info).toEqual({ root: r.dir, commonDir: join(r.dir, '.git'), shallow: false, headOid: head });
  });
  it('연결 worktree는 최상위가 다르고 공통 git 폴더는 같다', () => {
    const r = keep(tempRepo());
    r.write('a.md', 'x\n');
    r.commit();
    const wt = `${r.dir}-wt`;
    r.git('worktree', 'add', '-q', '-b', 'side', wt);
    made.push({ ...r, dir: wt, cleanup: () => rmSync(wt, { recursive: true, force: true }) });
    const info = repoInfo(wt);
    expect(info.root).toBe(wt);
    expect(info.commonDir).toBe(join(r.dir, '.git'));
  });
});

describe('resolveBase', () => {
  it('첫 커밋 전이면 빈 트리', () => {
    const r = keep(tempRepo());
    const b = resolveBase(repoInfo(r.dir));
    expect(b.oid).toBe(SHA1_EMPTY_TREE);
    expect(b.label).toBe('empty tree — no commits yet');
    expect(b.headIsBase).toBe(false);
  });
  it('원격이 없으면 로컬 main과의 분기점 — HEAD가 main 끝이면 headIsBase', () => {
    const r = keep(tempRepo());
    r.write('a.md', 'x\n');
    const head = r.commit();
    expect(resolveBase(repoInfo(r.dir))).toEqual({ oid: head, label: 'merge-base main', ref: 'refs/heads/main', headIsBase: true, upstream: null });
  });
  it('origin/HEAD가 가리키는 브랜치(trunk)를 먼저 쓴다', () => {
    const origin = keep(tempRepo());
    origin.git('checkout', '-q', '-b', 'trunk');
    origin.write('a.md', 'x\n');
    const trunk = origin.commit();
    const c = keep(cloneOf(origin));
    c.git('checkout', '-q', '-b', 'feature');
    c.write('a.md', 'y\n');
    c.commit();
    const b = resolveBase(repoInfo(c.dir));
    expect(b.label).toBe('merge-base origin/trunk');
    expect(b.oid).toBe(trunk);
    expect(b.headIsBase).toBe(false);
  });
  it('origin/HEAD가 없으면 origin/main', () => {
    const origin = keep(tempRepo());
    origin.write('a.md', 'x\n');
    const main = origin.commit();
    const c = keep(cloneOf(origin));
    c.git('remote', 'set-head', 'origin', '-d');
    c.git('checkout', '-q', '-b', 'feature');
    c.write('a.md', 'y\n');
    c.commit();
    const b = resolveBase(repoInfo(c.dir));
    expect(b.label).toBe('merge-base origin/main');
    expect(b.oid).toBe(main);
  });
  it('원격은 있는데 기본 브랜치를 못 찾으면 no-default-branch(--base 안내)', () => {
    const r = keep(tempRepo());
    r.write('a.md', 'x\n');
    r.commit();
    r.git('remote', 'add', 'origin', 'https://example.invalid/x.git');
    expect(codeOf(() => resolveBase(repoInfo(r.dir)))).toBe('no-default-branch');
    expect(() => resolveBase(repoInfo(r.dir))).toThrow('--base');
  });
  it('없는 --base는 unknown-ref', () => {
    const r = keep(tempRepo());
    r.write('a.md', 'x\n');
    r.commit();
    expect(codeOf(() => resolveBase(repoInfo(r.dir), 'nope'))).toBe('unknown-ref');
  });
  it('--base는 그 ref와의 분기점이다', () => {
    const r = keep(tempRepo());
    r.write('a.md', 'x\n');
    const first = r.commit();
    r.git('checkout', '-q', '-b', 'feature');
    r.write('a.md', 'y\n');
    r.commit();
    r.git('checkout', '-q', 'main');
    r.write('b.md', 'z\n');
    r.commit();
    r.git('checkout', '-q', 'feature');
    expect(resolveBase(repoInfo(r.dir), 'main')).toMatchObject({ oid: first, label: 'merge-base main' });
  });
  it('얕은 clone이라 분기점이 없으면 shallow — git fetch --deepen 안내', () => {
    const origin = keep(tempRepo());
    origin.write('a.md', 'A\n');
    origin.commit('A');
    origin.git('checkout', '-q', '-b', 'feature');
    origin.write('f.md', 'F\n');
    origin.commit('F');
    origin.git('checkout', '-q', 'main');
    origin.write('b.md', 'B\n');
    origin.commit('B');
    origin.write('c.md', 'C\n');
    origin.commit('C');
    const c = keep(cloneOf(origin, ['--depth', '1', '--branch', 'feature']));
    c.git('fetch', '-q', '--depth', '1', 'origin', 'main:refs/remotes/origin/main');
    expect(codeOf(() => resolveBase(repoInfo(c.dir), 'origin/main'))).toBe('shallow');
    expect(() => resolveBase(repoInfo(c.dir), 'origin/main')).toThrow('git fetch --deepen');
  });
  it('공통 조상이 없으면(얕지 않음) no-merge-base', () => {
    const r = keep(tempRepo());
    r.write('a.md', 'x\n');
    r.commit();
    r.git('checkout', '-q', '--orphan', 'other');
    r.write('b.md', 'y\n');
    r.commit();
    expect(codeOf(() => resolveBase(repoInfo(r.dir), 'main'))).toBe('no-merge-base');
  });
  it('upstream 원격이 있으면 권할 기준(upstream/main)을 알려 준다', () => {
    const up = keep(tempRepo());
    up.write('a.md', 'x\n');
    up.commit();
    const c = keep(cloneOf(up));
    c.git('remote', 'add', 'upstream', up.dir);
    c.git('fetch', '-q', 'upstream');
    expect(resolveBase(repoInfo(c.dir)).upstream).toBe('upstream/main');
  });
});

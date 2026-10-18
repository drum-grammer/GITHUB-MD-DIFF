import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { changedMarkdown, insideRepo, listMarkdown, parseNameStatus, readTextAt, readWorktree, repoInfo, resolveBase } from '../src/git';
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
const ten = (word: string): string => Array.from({ length: 10 }, (_, i) => `Line ${i + 1} about ${word}.`).join('\n') + '\n';
const base = (r: TempRepo): string => resolveBase(repoInfo(r.dir)).oid;

describe('parseNameStatus', () => {
  it('NUL로 나뉜 출력 — 이름 바꿈은 옛·새 두 경로, 한글·공백 경로는 그대로', () => {
    const raw = 'M\0a.md\0R087\0old.md\0new.md\0A\0문서/설계 노트.md\0D\0gone.md\0T\0link.md\0';
    expect(parseNameStatus(raw)).toEqual([
      { path: 'a.md', status: 'modified' },
      { path: 'new.md', oldPath: 'old.md', status: 'renamed' },
      { path: '문서/설계 노트.md', status: 'added' },
      { path: 'gone.md', status: 'deleted' },
      { path: 'link.md', status: 'modified' },
    ]);
  });
});

describe('changedMarkdown', () => {
  it('추적 중인 수정·스테이지한 추가·추적 안 하는 새 md·삭제를 고르고, md 아닌 파일은 뺀다', () => {
    const r = repo();
    r.write('docs/a.md', 'a\n');
    r.write('docs/gone.md', 'g\n');
    r.write('notes.txt', 't\n');
    r.commit();
    r.write('docs/a.md', 'a2\n');
    r.write('docs/staged.markdown', 's\n');
    r.git('add', 'docs/staged.markdown');
    r.write('docs/new.MDX', 'n\n');
    r.remove('docs/gone.md');
    r.write('notes.txt', 't2\n');
    expect(changedMarkdown(r.dir, base(r))).toEqual([
      { path: 'docs/a.md', status: 'modified' },
      { path: 'docs/gone.md', status: 'deleted' },
      { path: 'docs/new.MDX', status: 'added' },
      { path: 'docs/staged.markdown', status: 'added' },
    ]);
  });
  it('한글·공백 경로가 8진수 따옴표 없이 그대로 나온다', () => {
    const r = repo();
    r.write('문서/설계 노트.md', '처음\n');
    r.commit();
    r.write('문서/설계 노트.md', '고침\n');
    expect(changedMarkdown(r.dir, base(r))).toEqual([{ path: '문서/설계 노트.md', status: 'modified' }]);
  });
  it('git mv는 git이 이름 바꿈으로 낸다', () => {
    const r = repo();
    r.write('docs/old.md', ten('rename'));
    r.commit();
    r.git('mv', 'docs/old.md', 'docs/new.md');
    expect(changedMarkdown(r.dir, base(r))).toEqual([{ path: 'docs/new.md', oldPath: 'docs/old.md', status: 'renamed' }]);
  });
  it('그냥 mv(옛 경로 삭제 + 추적 안 하는 새 경로)도 내용이 비슷하면(0.5 이상) 이름 바꿈', () => {
    const r = repo();
    r.write('docs/old.md', ten('moving'));
    r.commit();
    renameSync(join(r.dir, 'docs/old.md'), join(r.dir, 'docs/new name.md'));
    writeFileSync(join(r.dir, 'docs/new name.md'), ten('moving').replace('Line 3', 'Row 3'));
    expect(changedMarkdown(r.dir, base(r))).toEqual([{ path: 'docs/new name.md', oldPath: 'docs/old.md', status: 'renamed' }]);
  });
  it('내용이 다르면 짝짓지 않는다', () => {
    const r = repo();
    r.write('docs/a.md', ten('alpha'));
    r.commit();
    r.remove('docs/a.md');
    r.write('docs/b.md', 'Something else entirely, with no shared words at all.\n');
    expect(changedMarkdown(r.dir, base(r))).toEqual([
      { path: 'docs/a.md', status: 'deleted' },
      { path: 'docs/b.md', status: 'added' },
    ]);
  });
  it('둘 다 추적 중인 삭제·추가는 git 판정을 그대로 둔다(추적 안 하는 새 파일만 다시 짝짓는다)', () => {
    const r = repo();
    r.write('docs/a.md', ten('alpha'));
    r.commit();
    r.remove('docs/a.md');
    r.write('docs/b.md', ten('alpha').replace('Line 1 ', 'Row 1 ').replace('Line 2 ', 'Row 2 ').replace('Line 3 ', 'Row 3 ').replace('Line 4 ', 'Row 4 ').replace('Line 5 ', 'Row 5 ').replace('Line 6 ', 'Row 6 '));
    r.git('add', '-A');
    const statuses = changedMarkdown(r.dir, base(r)).map((f) => f.status).sort();
    expect(statuses.includes('renamed') || statuses.join() === 'added,deleted').toBe(true);
    expect(listMarkdown(r.dir, base(r)).some((f) => f.untracked)).toBe(false);
  });
  it('첫 커밋 전(빈 트리 기준)이면 추적 안 하는 md가 모두 추가', () => {
    const r = repo();
    r.write('README.md', '# Hi\n');
    expect(changedMarkdown(r.dir, base(r))).toEqual([{ path: 'README.md', status: 'added' }]);
  });
});

describe('readTextAt', () => {
  it('기준 커밋의 원문, 없으면 null', () => {
    const r = repo();
    r.write('docs/a.md', 'v1\n');
    const oid = r.commit();
    r.write('docs/a.md', 'v2\n');
    expect(readTextAt(r.dir, oid, 'docs/a.md')).toBe('v1\n');
    expect(readTextAt(r.dir, oid, 'docs/none.md')).toBeNull();
  });
});

describe('readWorktree · insideRepo', () => {
  it('보통 파일은 글자, 없으면 missing', () => {
    const r = repo();
    r.write('a.md', 'hello\n');
    expect(readWorktree(r.dir, 'a.md')).toEqual({ kind: 'text', text: 'hello\n' });
    expect(readWorktree(r.dir, 'none.md')).toEqual({ kind: 'missing' });
  });
  it('저장소 밖을 가리키는 심링크는 따라가지 않고 링크 대상 글자만(git과 같이)', () => {
    const r = repo();
    const secret = join(tempDir(), 'secret.txt');
    writeFileSync(secret, 'TOKEN=abc\n');
    symlinkSync(secret, join(r.dir, 'notes.md'));
    expect(readWorktree(r.dir, 'notes.md')).toEqual({ kind: 'symlink', text: secret });
  });
  it('밖을 가리키는 폴더 심링크 안의 보통 파일은 읽지 않는다(realpath가 저장소 밖)', () => {
    const r = repo();
    const outside = tempDir();
    writeFileSync(join(outside, 'x.md'), 'outside\n');
    symlinkSync(outside, join(r.dir, 'linked'));
    expect(readWorktree(r.dir, 'linked/x.md')).toEqual({ kind: 'refused', reason: 'outside-repo' });
  });
  it('.git 안은 대소문자를 접어도 저장소 안으로 보지 않는다', () => {
    const r = repo();
    mkdirSync(join(r.dir, 'docs'));
    expect(insideRepo(r.dir, join(r.dir, '.git', 'config'))).toBe('git-dir');
    expect(insideRepo(r.dir, join(r.dir, '.GIT', 'config'))).not.toBe('inside');
    expect(insideRepo(r.dir, join(r.dir, 'docs'))).toBe('inside');
  });
});

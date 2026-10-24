import { afterEach, describe, expect, it } from 'vitest';
import { CliError } from '../src/errors';
import type { PrView } from '../src/gh';
import { checkoutWarning, cleanPrRefs, fetchPr, parsePrRef, pickRemote, prFiles } from '../src/pr';
import { cloneOf, tempRepo, type TempRepo } from './helpers/git-repo';

const made: TempRepo[] = [];
afterEach(() => {
  for (const r of made.splice(0)) r.cleanup();
});
const keep = <T extends TempRepo>(r: T): T => {
  made.push(r);
  return r;
};
const GH_URL = 'https://github.com/acme/docs.git';

/**
 * 가짜 GitHub — bare 원격 하나에 main과 refs/pull/7/head. PR 뒤에 main이 앞서 나간다(분기점 ≠ base).
 * clone의 원격 주소는 GitHub 주소로 두고 insteadOf로 bare 폴더를 가리켜 네트워크 없이 받는다
 */
function world() {
  const origin = keep(tempRepo({ bare: true }));
  const author = keep(tempRepo());
  author.write('docs/a.md', '# A\n\nold line\n');
  author.write('docs/gone.md', '# Gone\n\nbye\n');
  author.write('docs/moved.md', '# Moved\n\nsame text in a long enough paragraph to pair\n');
  author.write('code.ts', 'x\n');
  const mergeBase = author.commit('base');
  author.git('remote', 'add', 'origin', origin.dir);
  author.git('push', '-q', 'origin', 'main');
  author.git('checkout', '-q', '-b', 'feature');
  author.write('docs/a.md', '# A\n\nnew line\n');
  author.remove('docs/gone.md');
  author.git('mv', 'docs/moved.md', 'docs/renamed.md');
  author.write('docs/new.md', '# New\n');
  author.write('code.ts', 'y\n');
  const head = author.commit('feature');
  author.git('push', '-q', 'origin', 'feature:refs/pull/7/head');
  author.git('checkout', '-q', 'main');
  author.write('docs/a.md', '# A\n\nold line\n\nbase moved on\n');
  const base = author.commit('base moves');
  author.git('push', '-q', 'origin', 'main');
  const clone = keep(cloneOf(origin));
  clone.git('remote', 'set-url', 'origin', GH_URL);
  clone.git('config', `url.${origin.dir}.insteadOf`, GH_URL);
  const view: PrView = { owner: 'acme', repo: 'docs', number: 7, url: 'https://github.com/acme/docs/pull/7', title: 'Docs', baseRefName: 'main', baseRefOid: base, headRefOid: head };
  return { origin, author, clone, view, mergeBase, head, base };
}

describe('parsePrRef', () => {
  it('7, https://github.com/acme/docs/pull/7/files#x는 받고 0, -1, owner/repo#7, http://는 2', () => {
    expect(parsePrRef('7')).toBe('7');
    expect(parsePrRef('https://github.com/acme/docs/pull/7/files#x')).toBe('https://github.com/acme/docs/pull/7');
    expect(parsePrRef('https://github.com/acme/docs.site/pull/12?w=1')).toBe('https://github.com/acme/docs.site/pull/12');
    for (const bad of ['0', '-1', 'acme/docs#7', 'http://github.com/acme/docs/pull/7', 'https://github.com/acme/docs/issues/7', '7a']) {
      expect(() => parsePrRef(bad), bad).toThrow(CliError);
      try {
        parsePrRef(bad);
      } catch (e) {
        expect((e as CliError).code).toBe(2);
        expect((e as CliError).message).toBe('--pr takes a pull request number or a https://github.com/<owner>/<repo>/pull/<number> URL');
      }
    }
  });
});

describe('fetchPr', () => {
  it('두 ref를 받고 OID·분기점을 확정, 작업 트리·HEAD는 그대로', () => {
    const { clone, view, mergeBase, head, base } = world();
    const before = clone.git('rev-parse', 'HEAD');
    const pr = fetchPr(clone.dir, view);
    expect(pr).toEqual({ owner: 'acme', repo: 'docs', number: 7, url: view.url, title: 'Docs', baseOid: base, headOid: head, mergeBase });
    expect(clone.git('rev-parse', 'refs/markdown-diff-cat/pr/7/head')).toBe(head);
    expect(clone.git('rev-parse', 'refs/markdown-diff-cat/pr/7/base')).toBe(base);
    expect(clone.git('rev-parse', 'HEAD')).toBe(before);
    expect(clone.git('status', '--porcelain')).toBe('');
  });

  it('포크 — origin이 포크면 base 저장소 원격(upstream)을 고른다', () => {
    const { clone } = world();
    clone.git('remote', 'rename', 'origin', 'upstream');
    clone.git('remote', 'add', 'origin', 'git@github.com:me/docs.git');
    expect(pickRemote(clone.dir, 'acme', 'docs')).toBe('upstream');
    expect(pickRemote(clone.dir, 'me', 'docs')).toBe('origin');
    clone.git('remote', 'add', 'other', 'ssh://git@github.com/Acme/Docs');
    clone.git('remote', 'remove', 'upstream');
    expect(pickRemote(clone.dir, 'acme', 'docs')).toBe('other');
    expect(pickRemote(clone.dir, 'acme', 'site')).toBeNull();
  });

  it('맞는 원격이 없으면 저장소 URL로 직접 받는다', () => {
    const { clone, view, head } = world();
    clone.git('remote', 'set-url', 'origin', 'git@github.com:me/docs.git');
    expect(fetchPr(clone.dir, view).headOid).toBe(head);
    expect(clone.git('rev-parse', 'refs/markdown-diff-cat/pr/7/head')).toBe(head);
  });

  it('받은 head가 headRefOid와 다르면 OID로 한 번 더 받는다', () => {
    const { author, origin, clone, view } = world();
    origin.git('config', 'uploadpack.allowAnySHA1InWant', 'true');
    author.git('checkout', '-q', 'feature');
    author.write('docs/a.md', '# A\n\nnewer line\n');
    const newer = author.commit('newer');
    author.git('push', '-q', 'origin', 'feature:refs/heads/elsewhere');
    const pr = fetchPr(clone.dir, { ...view, headRefOid: newer });
    expect(pr.headOid).toBe(newer);
    expect(clone.git('rev-parse', 'refs/markdown-diff-cat/pr/7/head')).toBe(newer);
  });

  it('받지 못하면 git-failed로 이유를 말한다', () => {
    const { clone, view } = world();
    expect(() => fetchPr(clone.dir, { ...view, number: 99 })).toThrow(/could not fetch acme\/docs#99/);
  });
});

describe('prFiles', () => {
  it('md만, 이름 바꿈·지움·추가, 옛 쪽은 분기점 원문(base 브랜치가 앞서 나가도)', () => {
    const { clone, view } = world();
    const files = prFiles(clone.dir, fetchPr(clone.dir, view));
    expect(files.map(({ path, oldPath, status }) => ({ path, oldPath, status }))).toEqual([
      { path: 'docs/a.md', oldPath: undefined, status: 'modified' },
      { path: 'docs/gone.md', oldPath: undefined, status: 'deleted' },
      { path: 'docs/new.md', oldPath: undefined, status: 'added' },
      { path: 'docs/renamed.md', oldPath: 'docs/moved.md', status: 'renamed' },
    ]);
    expect(files[0]).toMatchObject({ oldText: '# A\n\nold line\n', newText: '# A\n\nnew line\n' });
    expect(files[1]).toMatchObject({ oldText: '# Gone\n\nbye\n', newText: null });
    expect(files[2]).toMatchObject({ oldText: null, newText: '# New\n' });
  });
});

describe('cleanPrRefs · checkoutWarning', () => {
  it('cleanPrRefs — 고른 PR 번호의 ref만(다른 worktree가 받은 PR은 둔다)', () => {
    const { clone, view } = world();
    fetchPr(clone.dir, view);
    clone.git('update-ref', 'refs/markdown-diff-cat/pr/99/head', 'HEAD');
    expect(cleanPrRefs(clone.dir, [7])).toEqual(['refs/markdown-diff-cat/pr/7/base', 'refs/markdown-diff-cat/pr/7/head']);
    expect(clone.git('for-each-ref', '--format=%(refname)', 'refs/markdown-diff-cat/')).toBe('refs/markdown-diff-cat/pr/99/head');
    expect(cleanPrRefs(clone.dir, [])).toEqual([]);
  });
  it('cleanPrRefs — refs/markdown-diff-cat/ 아래만 지운다', () => {
    const { clone, view } = world();
    fetchPr(clone.dir, view);
    clone.git('update-ref', 'refs/keep/me', 'HEAD');
    expect(cleanPrRefs(clone.dir)).toEqual(['refs/markdown-diff-cat/pr/7/base', 'refs/markdown-diff-cat/pr/7/head']);
    expect(clone.git('for-each-ref', '--format=%(refname)')).not.toContain('markdown-diff-cat');
    expect(clone.git('for-each-ref', '--format=%(refname)')).toContain('refs/keep/me');
    expect(cleanPrRefs(clone.dir)).toEqual([]);
  });

  it('checkoutWarning — HEAD가 다르면 gh pr checkout 안내, 같고 깨끗하면 null, 그 파일이 바뀌었으면 경고', () => {
    const { clone, view, head } = world();
    const pr = fetchPr(clone.dir, view);
    expect(checkoutWarning(clone.dir, pr, ['docs/a.md'])).toBe(`HEAD is not the head of acme/docs#7 (${head.slice(0, 7)}) — line numbers refer to the pull request head. Run gh pr checkout 7 before editing.`);
    clone.git('checkout', '-q', '--detach', head);
    expect(checkoutWarning(clone.dir, pr, ['docs/a.md'])).toBeNull();
    clone.write('docs/a.md', 'edited\n');
    expect(checkoutWarning(clone.dir, pr, ['docs/new.md'])).toBeNull();
    expect(checkoutWarning(clone.dir, pr, ['docs/a.md'])).toBe(`The working tree has changes in files of acme/docs#7 — line numbers refer to the pull request head (${head.slice(0, 7)}).`);
  });
});

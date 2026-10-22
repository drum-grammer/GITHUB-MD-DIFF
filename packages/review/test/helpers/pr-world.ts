// 가짜 PR 원격 — bare 원격 하나에 main과 refs/pull/7/head, PR 뒤에 main이 앞서 나간다(분기점 ≠ base).
// clone의 원격 주소는 GitHub 주소로 두고 insteadOf로 bare 폴더를 가리켜 네트워크 없이 받는다
import type { PrView } from '../../src/gh';
import { cloneOf, tempRepo, type TempRepo } from './git-repo';

export const GH_URL = 'https://github.com/acme/docs.git';

export interface PrWorld {
  origin: TempRepo;
  author: TempRepo;
  clone: TempRepo;
  view: PrView;
  mergeBase: string;
  head: string;
  base: string;
  cleanup(): void;
}

export interface WorldFiles {
  base: Record<string, string>;
  /** PR 브랜치의 변경 — null이면 지운다, {to}면 git mv */
  head: Record<string, string | null | { to: string }>;
}

export const DEFAULT_FILES: WorldFiles = {
  base: {
    'docs/a.md': '# A\n\nold line\n',
    'docs/gone.md': '# Gone\n\nbye\n',
    'docs/moved.md': '# Moved\n\nsame text in a long enough paragraph to pair\n',
    'code.ts': 'x\n',
  },
  head: { 'docs/a.md': '# A\n\nnew line\n', 'docs/gone.md': null, 'docs/moved.md': { to: 'docs/renamed.md' }, 'docs/new.md': '# New\n', 'code.ts': 'y\n' },
};

export function prWorld(files: WorldFiles = DEFAULT_FILES): PrWorld {
  const origin = tempRepo({ bare: true });
  const author = tempRepo();
  for (const [p, t] of Object.entries(files.base)) author.write(p, t);
  const mergeBase = author.commit('base');
  author.git('remote', 'add', 'origin', origin.dir);
  author.git('push', '-q', 'origin', 'main');
  author.git('checkout', '-q', '-b', 'feature');
  for (const [p, t] of Object.entries(files.head)) {
    if (t === null) author.remove(p);
    else if (typeof t === 'object') author.git('mv', p, t.to);
    else author.write(p, t);
  }
  const head = author.commit('feature');
  author.git('push', '-q', 'origin', 'feature:refs/pull/7/head');
  author.git('checkout', '-q', 'main');
  author.write('base-only.md', '# Moved on\n');
  const base = author.commit('base moves');
  author.git('push', '-q', 'origin', 'main');
  const clone = cloneOf(origin);
  clone.git('remote', 'set-url', 'origin', GH_URL);
  clone.git('config', `url.${origin.dir}.insteadOf`, GH_URL);
  const view: PrView = { owner: 'acme', repo: 'docs', number: 7, url: 'https://github.com/acme/docs/pull/7', title: 'Docs', baseRefName: 'main', baseRefOid: base, headRefOid: head };
  return {
    origin,
    author,
    clone,
    view,
    mergeBase,
    head,
    base,
    cleanup() {
      for (const r of [origin, author, clone]) r.cleanup();
    },
  };
}

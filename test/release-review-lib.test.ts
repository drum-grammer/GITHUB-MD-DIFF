// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PACK_FILES,
  SIZE_LIMIT,
  assetName,
  attachGate,
  commitGate,
  manifestProblems,
  npmGate,
  npmReadme,
  packProblems,
  parseReviewArgs,
  publishGate,
  publishManifest,
  versionsProblems,
} from '../scripts/release-review-lib.mjs';

const pkg = {
  name: 'markdown-diff-cat',
  version: '1.6.0',
  description: 'd',
  type: 'module',
  bin: { 'markdown-diff-cat': 'dist/markdown-diff-cat.mjs' },
  files: ['dist/markdown-diff-cat.mjs', 'README.md', 'LICENSE'],
  engines: { node: '>=22' },
  license: 'MIT',
  repository: { type: 'git', url: 'git+https://github.com/drum-grammer/GITHUB-MD-DIFF.git', directory: 'packages/review' },
  scripts: { build: 'node build.mjs' },
  devDependencies: { '@markdown-diff-cat/engine': 'workspace:*', esbuild: '^0.28.2' },
};
const record = { version: '1.6.0', commit: 'a'.repeat(40), sha256: 'f'.repeat(64), size: 4_000_000, stage: '/x/npm', checkedAt: '' };

describe('버전·패키지 정의', () => {
  it('세 버전(루트·manifest·packages/review)이 같아야 한다', () => {
    expect(versionsProblems({ root: '1.6.0', manifest: '1.6.0', review: '1.6.0' })).toEqual([]);
    expect(versionsProblems({ root: '1.6.0', manifest: '1.6.0', review: '1.5.1' })[0]).toContain('packages/review/package.json 1.5.1');
  });
  it('npm에 싣는 package.json은 개발용 항목(scripts·devDependencies)을 뺀다 — workspace: 글자가 바깥에 나가지 않게', () => {
    const out = publishManifest(pkg);
    expect(out).not.toHaveProperty('scripts');
    expect(out).not.toHaveProperty('devDependencies');
    expect(JSON.stringify(out)).not.toContain('workspace:');
    expect(out).toMatchObject({ name: 'markdown-diff-cat', version: '1.6.0', bin: pkg.bin, files: pkg.files, engines: pkg.engines, license: 'MIT' });
  });
  it('private·런타임 의존·이름 틀림은 문제', () => {
    expect(manifestProblems(pkg)).toEqual([]);
    expect(manifestProblems({ ...pkg, private: true })[0]).toContain('private');
    expect(manifestProblems({ ...pkg, dependencies: { 'markdown-it': '^15' } })[0]).toContain('markdown-it');
    expect(manifestProblems({ ...pkg, name: 'mdcat' })[0]).toContain('mdcat');
  });
  it('npm pack 목록은 정확히 넷, 크기는 한도 안', () => {
    const files = PACK_FILES.map((path: string) => ({ path }));
    expect(packProblems({ files, unpackedSize: 4_000_000 })).toEqual([]);
    expect(packProblems({ files: [...files, { path: 'src/cli.ts' }], unpackedSize: 1 })[0]).toContain('src/cli.ts');
    expect(packProblems({ files, unpackedSize: SIZE_LIMIT + 1 })[0]).toContain('크다');
  });
  it('npm에 싣는 README에서는 "아직 npm에 없음" 안내를 뺀다', () => {
    const text = '# markdown-diff-cat\n\n<!-- pre-npm -->\n> Not on npm yet — run it with node.\n<!-- /pre-npm -->\n\nReview the Markdown.\n';
    expect(npmReadme(text)).toBe('# markdown-diff-cat\n\nReview the Markdown.\n');
    expect(npmReadme('# x\n\nno note\n')).toBe('# x\n\nno note\n');
    expect(npmReadme(readFileSync('packages/review/README.md', 'utf8'))).not.toContain('Not on npm yet');
  });
  it('이름과 인자', () => {
    expect(assetName('1.6.0')).toBe('markdown-diff-cat-1.6.0.mjs');
    expect(parseReviewArgs(['attach', '--confirm', '1.6.0'])).toEqual({ step: 'attach', confirm: '1.6.0' });
    expect(parseReviewArgs(['check'])).toEqual({ step: 'check', confirm: undefined });
  });
});

describe('관문', () => {
  it('npm에 이미 있는 번호는 다시 낼 수 없다', () => {
    expect(npmGate({ version: '1.6.0', published: ['1.5.1'] })).toBeNull();
    expect(npmGate({ version: '1.6.0', published: ['1.6.0'] })).toContain('이미 있다');
  });
  it('확장 릴리스 커밋(태그)에서만 빌드한다 — origin/main이 앞서 있어도', () => {
    expect(commitGate({ head: 'a'.repeat(40), releaseCommit: 'a'.repeat(40), porcelain: '' })).toBeNull();
    expect(commitGate({ head: 'b'.repeat(40), releaseCommit: 'a'.repeat(40), porcelain: '' })).toContain('git switch --detach');
    expect(commitGate({ head: 'a'.repeat(40), releaseCommit: null, porcelain: '' })).toContain('record.json');
    expect(commitGate({ head: 'a'.repeat(40), releaseCommit: 'a'.repeat(40), porcelain: ' M x' })).toContain('깨끗하지');
  });
  it('attach — 기록·버전 직접 적기·같은 빌드·확장 Release가 먼저·아직 안 붙음', () => {
    const ok = { confirm: '1.6.0', builtSha: record.sha256, releaseExists: true, assets: ['markdown-diff-cat-for-github-1.6.0.zip'] };
    expect(attachGate(record, ok)).toBeNull();
    expect(attachGate(null, ok)).toContain('check');
    expect(attachGate(record, { ...ok, confirm: '1.6' })).toContain('--confirm 1.6.0');
    expect(attachGate(record, { ...ok, builtSha: '0' })).toContain('check 때와 다르다');
    expect(attachGate(record, { ...ok, releaseExists: false })).toContain('pnpm release finish');
    expect(attachGate(record, { ...ok, assets: ['markdown-diff-cat-1.6.0.mjs'] })).toContain('이미 붙어 있다');
  });
  it('publish — attach가 먼저, 게시용 폴더의 파일도 check 때와 같아야, npm에 없는 번호만', () => {
    const attached = { ...record, attach: { at: '', asset: 'markdown-diff-cat-1.6.0.mjs' } };
    const ok = { confirm: '1.6.0', builtSha: record.sha256, stagedSha: record.sha256, published: ['1.5.1'] };
    expect(publishGate(attached, ok)).toBeNull();
    expect(publishGate(record, ok)).toContain('release-review attach');
    expect(publishGate(attached, { ...ok, confirm: undefined })).toContain('--confirm 1.6.0');
    expect(publishGate(attached, { ...ok, stagedSha: '0' })).toContain('게시용 폴더');
    expect(publishGate(attached, { ...ok, published: ['1.6.0'] })).toContain('이미 있다');
  });
});

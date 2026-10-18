import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;

describe('npm 패키지 markdown-diff-cat', () => {
  it('이름·실행 파일·Node·라이선스·싣는 파일', () => {
    expect(pkg.name).toBe('markdown-diff-cat');
    expect(pkg).not.toHaveProperty('private');
    expect(pkg.type).toBe('module');
    expect(pkg.bin).toEqual({ 'markdown-diff-cat': 'dist/markdown-diff-cat.mjs' });
    expect(pkg.engines).toEqual({ node: '>=22' });
    expect(pkg.license).toBe('MIT');
    expect(pkg.files).toEqual(['dist/markdown-diff-cat.mjs', 'README.md', 'LICENSE']);
  });
  it('런타임 의존이 없다 — 엔진·플러그인·자산은 모두 번들에 넣는다', () => {
    expect(pkg).not.toHaveProperty('dependencies');
    expect(pkg).not.toHaveProperty('peerDependencies');
    expect(pkg).not.toHaveProperty('optionalDependencies');
  });
  it('워크스페이스 엔진은 devDependencies에만 있다', () => {
    expect((pkg.devDependencies as Record<string, string>)['@markdown-diff-cat/engine']).toBe('workspace:*');
  });
  it('LICENSE는 저장소 루트와 같다', () => {
    expect(readFileSync('LICENSE', 'utf8')).toBe(readFileSync('../../LICENSE', 'utf8'));
  });
  it('버전은 확장(루트 package.json)과 같다', () => {
    expect(pkg.version).toBe((JSON.parse(readFileSync('../../package.json', 'utf8')) as { version: string }).version);
  });
});

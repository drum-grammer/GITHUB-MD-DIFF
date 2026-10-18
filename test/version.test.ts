import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const version = (path: string): string => (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;

describe('버전', () => {
  it('manifest와 package.json이 같은 SemVer 버전이다', () => {
    const manifest = version('static/manifest.json');
    expect(manifest).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    expect(version('package.json')).toBe(manifest);
  });
  it('로컬 리뷰 CLI(npm markdown-diff-cat)도 확장과 같은 번호다 — 같은 태그 vX.Y.Z로 낸다', () => {
    expect(version('packages/review/package.json')).toBe(version('static/manifest.json'));
  });
});

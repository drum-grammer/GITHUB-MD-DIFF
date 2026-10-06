import { describe, expect, it } from 'vitest';
import { fileKey, isPrChangesPage } from '../src/page';

describe('isPrChangesPage', () => {
  it.each([
    ['https://github.com/o/r/pull/12/changes', true],
    ['https://github.com/o/r/pull/12/files', true],
    ['https://github.com/o/r/pull/12/changes/abc123', true],
    ['https://github.com/o/r/pull/12/changes?w=1#diff-1', true],
    ['https://github.com/o/r/pull/12', false],
    ['https://github.com/o/r/pull/12/commits', false],
    ['https://github.com/o/r/blob/main/README.md', false],
    ['not a url', false],
  ])('%s → %s', (url, want) => {
    expect(isPrChangesPage(url)).toBe(want);
  });
});

describe('fileKey', () => {
  it('PR 경로와 파일 id를 묶는다 — 파일 id는 경로 해시라 PR이 달라도 같기 때문', () => {
    expect(fileKey('https://github.com/o/r/pull/1/changes', 'diff-aa')).toBe('/o/r/pull/1#diff-aa');
    expect(fileKey('https://github.com/o/r/pull/2/changes#x', 'diff-aa')).toBe('/o/r/pull/2#diff-aa');
  });
});

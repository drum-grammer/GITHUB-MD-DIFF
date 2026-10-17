import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadFixtures } from '../parity/run';
import { check } from './invariants';

// 공개 testbed 저장소 PR에서 받은 것과 손으로 만든 것만 — 확장 저장소는 공개다
const HEADER = /^<!-- source: (handmade|https:\/\/github\.com\/drum-grammer\/markdown-diff-cat-testbed\/pull\/\d+) · captured: \d{4}-\d{2}-\d{2} -->$/;
const DIR = 'packages/engine/test/parity';
const names = readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

describe('패리티 고정 자료', () => {
  it('하나 이상 있다', () => expect(names.length).toBeGreaterThan(0));

  it.each(names)('%s — 파일 넷, 첫 줄이 공개 출처', (name) => {
    const files = readdirSync(`${DIR}/${name}`).sort();
    expect(files).toEqual(['github.html', 'meta.json', 'new.md', 'old.md']);
    expect(readFileSync(`${DIR}/${name}/github.html`, 'utf8').split('\n')[0]).toMatch(HEADER);
  });

  it.each(loadFixtures(DIR).map((f) => [f.name, f] as const))('%s — 엔진 불변식', (_name, f) => {
    if (f.oldText !== null) check(f.oldText, f.newText, f.meta.path);
  });
});

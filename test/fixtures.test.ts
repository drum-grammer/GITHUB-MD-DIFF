import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 공개 저장소 소유자만 — 이 저장소는 공개할 예정이라 비공개 저장소 화면을 고정 자료로 쓰지 않는다
const ALLOWED_OWNERS = ['github'];
const HEADER = /^<!-- source: (handmade|https:\/\/github\.com\/([^/]+)\/\S+) · captured: \d{4}-\d{2}-\d{2} -->$/;
const files = readdirSync('test/fixtures').filter((f) => f.endsWith('.html'));

describe('고정 자료 출처', () => {
  it('고정 자료가 하나 이상 있다', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(files)('%s 첫 줄이 공개 출처다', (name) => {
    const first = readFileSync(`test/fixtures/${name}`, 'utf8').split('\n')[0];
    const m = first.match(HEADER);
    expect(m, '첫 줄: <!-- source: handmade|<공개 PR URL> · captured: YYYY-MM-DD -->').not.toBeNull();
    if (m && m[1] !== 'handmade') expect(ALLOWED_OWNERS).toContain(m[2]);
  });
});

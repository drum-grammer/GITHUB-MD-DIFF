// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareListing, textsFrom } from '../scripts/store-texts.mjs';

describe('등록정보 글', () => {
  it('정본 문서에서 대시보드 칸마다 글을 읽는다', () => {
    const cur = textsFrom((p: string) => readFileSync(p, 'utf8'));
    for (const [k, v] of Object.entries(cur)) expect(String(v).length, k).toBeGreaterThan(10);
  });

  it('같은 커밋과 비교하면 바뀐 칸이 없다', () => {
    const atHead = textsFrom((p: string) => execFileSync('git', ['show', `HEAD:${p}`], { encoding: 'utf8' }));
    const { changed, prevRead } = compareListing('HEAD', atHead);
    expect([...changed]).toEqual([]);
    expect(prevRead).toBe(true);
  });

  it('없는 기준이면 전부 바뀐 것으로 본다', () => {
    const cur = textsFrom((p: string) => readFileSync(p, 'utf8'));
    const { changed, imagesChanged, prevRead } = compareListing('no-such-ref', cur);
    expect(prevRead).toBe(false);
    expect(changed.size).toBe(Object.keys(cur).length);
    expect(imagesChanged).toBe(true);
  });
});

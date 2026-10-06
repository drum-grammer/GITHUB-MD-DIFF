import { beforeEach, describe, expect, it } from 'vitest';
import { foldBars, foldUnchanged } from '../src/fold';
import { loadFixture } from './helpers';

describe('foldUnchanged', () => {
  let body: HTMLElement;
  beforeEach(() => {
    body = loadFixture('handmade-prose.html');
  });

  it('보이는 블록이 있는 묶음마다 막대 하나(앵커만 있는 묶음은 뺀다)', () => {
    expect(foldUnchanged(body)).toBe(2);
    expect(foldBars(body)).toHaveLength(2);
  });

  it('막대 문구에 블록 수와 마지막 제목이 들어간다', () => {
    foldUnchanged(body);
    const [a, b] = foldBars(body);
    expect(a.textContent).toContain('foldBlocksHeading:4|설치');
    expect(b.textContent).toContain('foldBlocks:1');
  });

  it('묶음은 숨기고, 막대를 누르면 그 묶음만 펼친다', () => {
    foldUnchanged(body);
    const [a, b] = foldBars(body);
    const runA = a.nextElementSibling!;
    expect(runA.classList.contains('mdf-hidden')).toBe(true);
    expect(a.getAttribute('aria-expanded')).toBe('false');
    a.click();
    expect(runA.classList.contains('mdf-hidden')).toBe(false);
    expect(a.getAttribute('aria-expanded')).toBe('true');
    expect(b.nextElementSibling!.classList.contains('mdf-hidden')).toBe(true);
    a.click();
    expect(runA.classList.contains('mdf-hidden')).toBe(true);
  });

  it('두 번 불러도 막대가 늘지 않는다', () => {
    foldUnchanged(body);
    expect(foldUnchanged(body)).toBe(0);
    expect(foldBars(body)).toHaveLength(2);
  });

  it('vicinity·changed 블록은 그대로 보인다', () => {
    foldUnchanged(body);
    for (const el of body.querySelectorAll('.vicinity, .changed')) {
      expect(el.classList.contains('mdf-hidden')).toBe(false);
    }
  });
});

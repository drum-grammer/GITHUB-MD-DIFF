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
    expect(b.textContent).toContain('foldBlockOne');
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

describe('foldUnchanged — 묶음 없이 블록마다 unchanged가 붙은 화면', () => {
  let body: HTMLElement;
  beforeEach(() => {
    body = loadFixture('handmade-flat.html');
  });

  it('연속된 변경 없는 블록마다 막대 하나 — 블록 수는 앵커를 빼고 센다', () => {
    expect(foldUnchanged(body)).toBe(3);
    expect(foldBars(body).map((b) => b.textContent)).toEqual([
      '▸foldBlocksHeading:5|배경',
      '▸foldBlocksHeading:4|맺음',
      '▸foldBlockOne',
    ]);
  });

  it('변경 없는 블록·표시 없는 표·도표는 숨고, 바뀐 곳 옆 문맥과 그 제목의 앵커는 보인다', () => {
    foldUnchanged(body);
    const hidden = (sel: string) => body.querySelector(sel)!.classList.contains('mdf-hidden');
    expect(hidden(':scope > h1')).toBe(true);
    expect(hidden(':scope > markdown-accessiblity-table')).toBe(true);
    expect(hidden(':scope > blockquote')).toBe(true);
    expect(hidden(':scope > section')).toBe(true);
    expect(hidden(':scope > h2.vicinity')).toBe(false);
    expect(hidden('a[href="#바뀐-절"]')).toBe(false);
    expect(hidden(':scope > hr.vicinity')).toBe(false);
  });

  it('표시를 알 수 없는 블록은 접지 않는다', () => {
    foldUnchanged(body);
    expect(body.querySelector('.unknown-thing')!.classList.contains('mdf-hidden')).toBe(false);
  });

  it('막대를 누르면 그 묶음만 펼친다', () => {
    foldUnchanged(body);
    const [, second, third] = foldBars(body);
    second.click();
    expect(body.querySelector(':scope > section')!.classList.contains('mdf-hidden')).toBe(false);
    expect(body.querySelector(':scope > h3')!.classList.contains('mdf-hidden')).toBe(false);
    expect(third.nextElementSibling!.classList.contains('mdf-hidden')).toBe(true);
    second.click();
    expect(body.querySelector(':scope > section')!.classList.contains('mdf-hidden')).toBe(true);
  });

  it('두 번 불러도 막대가 늘지 않는다', () => {
    foldUnchanged(body);
    expect(foldUnchanged(body)).toBe(0);
    expect(foldBars(body)).toHaveLength(3);
  });
});

describe('foldUnchanged — 옛 화면(로그아웃): 묶음 맨 앞에 펼치기 아이콘, prose-diff.collapsed', () => {
  let body: HTMLElement;
  beforeEach(() => {
    body = loadFixture('handmade-classic.html');
  });

  it('펼치기 아이콘은 블록으로 세지 않는다 — 아이콘·앵커뿐인 묶음엔 막대가 없다', () => {
    expect(foldUnchanged(body)).toBe(2);
    expect(foldBars(body).map((b) => b.textContent)).toEqual(['▸foldBlockOne', '▸foldBlocksHeading:3|배경']);
  });

  it('아이콘·앵커뿐인 묶음은 막대 없이 숨긴다', () => {
    foldUnchanged(body);
    const empty = [...body.querySelectorAll(':scope > .expandable')].filter((e) => !e.querySelector('p, h2'));
    expect(empty).toHaveLength(3);
    for (const e of empty) expect(e.classList.contains('mdf-hidden')).toBe(true);
  });

  it('GitHub의 collapsed를 떼어 막대로 펼친 내용이 보이게 하고, 두 번 불러도 같다', () => {
    const prose = body.closest('.prose-diff')!;
    foldUnchanged(body);
    expect(prose.classList.contains('collapsed')).toBe(false);
    expect(prose.hasAttribute('data-mdf-uncollapsed')).toBe(true);
    expect(foldUnchanged(body)).toBe(0);
    expect(foldBars(body)).toHaveLength(2);
  });
});

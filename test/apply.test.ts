import { beforeEach, describe, expect, it } from 'vitest';
import { applyBody, undoAll } from '../src/apply';
import { loadFixture } from './helpers';

describe('applyBody / undoAll', () => {
  let body: HTMLElement;
  let original: string;
  beforeEach(() => {
    body = loadFixture('handmade-prose.html');
    original = body.innerHTML;
  });

  it('접기 2개, 표 1개, 오류 없음', () => {
    expect(applyBody(body)).toEqual({ folds: 2, tables: 1, errors: [] });
    expect(body.firstElementChild?.getAttribute('data-mdf')).toBe('file-toolbar');
  });

  it('두 번 적용해도 한 번과 같다', () => {
    applyBody(body);
    const once = body.innerHTML;
    applyBody(body);
    expect(body.innerHTML).toBe(once);
  });

  it('걷어내면 HTML이 처음과 글자 하나까지 같다', () => {
    applyBody(body);
    undoAll(document);
    expect(body.innerHTML).toBe(original);
  });

  it('펼치고 원래 표로 바꾼 뒤 걷어내도 처음과 같다', () => {
    applyBody(body);
    body.querySelector<HTMLElement>('[data-mdf="file-toolbar"] button')!.click();
    body.querySelector<HTMLElement>('[data-mdf-action="original"]')!.click();
    undoAll(document);
    expect(body.innerHTML).toBe(original);
  });

  it('GitHub가 본문을 다시 그린 뒤 다시 적용해도 한 벌만', () => {
    applyBody(body);
    body.innerHTML = original; // 다시 그리기 흉내
    applyBody(body);
    expect(body.querySelectorAll('[data-mdf="fold"]')).toHaveLength(2);
    expect(body.querySelectorAll('[data-mdf="table"]')).toHaveLength(1);
    expect(body.querySelectorAll('[data-mdf="file-toolbar"]')).toHaveLength(1);
  });
});

describe('파일 버튼', () => {
  it('모두 펼치기 ↔ 바뀐 부분만 — 본문 묶음과 표의 같은 행을 함께', () => {
    const body = loadFixture('handmade-prose.html');
    applyBody(body);
    const btn = body.querySelector<HTMLElement>('[data-mdf="file-toolbar"] button')!;
    expect(btn.textContent).toBe('expandAll');
    // 앵커뿐인 묶음은 보일 것이 없어 늘 숨어 있다 — 내용 있는 묶음만 센다
    const hiddenWithContent = () =>
      [...body.querySelectorAll('.expandable.unchanged.mdf-hidden')].filter((e) => e.querySelector(':scope > :not(a.anchor):not(svg)'));
    btn.click();
    expect(hiddenWithContent()).toHaveLength(0);
    expect(body.querySelectorAll('tr.mdf-row-same.mdf-hidden')).toHaveLength(0);
    expect(btn.textContent).toBe('changedOnly');
    btn.click();
    expect(hiddenWithContent()).toHaveLength(2);
    expect(body.querySelectorAll('tr.mdf-row-same.mdf-hidden')).toHaveLength(3);
  });

  it('접을 것이 없으면 버튼을 달지 않는다', () => {
    document.body.innerHTML = '<div class="prose-diff"><div class="markdown-body"><div class="changed">x</div></div></div>';
    const body = document.querySelector<HTMLElement>('.markdown-body')!;
    expect(applyBody(body)).toEqual({ folds: 0, tables: 0, errors: [] });
    expect(body.querySelector('[data-mdf]')).toBeNull();
  });
});

describe('applyBody / undoAll — 묶음 없는 화면', () => {
  it('접기 3개·표 1개, 두 번 적용해도 같고, 걷어내면 처음과 같다', () => {
    const body = loadFixture('handmade-flat.html');
    const original = body.innerHTML;
    expect(applyBody(body)).toEqual({ folds: 3, tables: 1, errors: [] });
    const once = body.innerHTML;
    applyBody(body);
    expect(body.innerHTML).toBe(once);
    body.querySelector<HTMLElement>('[data-mdf="file-toolbar"] button')!.click();
    undoAll(document);
    expect(body.innerHTML).toBe(original);
  });
});

describe('applyBody / undoAll — 옛 화면(prose-diff.collapsed)', () => {
  it('접기 2개, 두 번 적용해도 같고, 걷어내면 collapsed까지 처음과 같다', () => {
    const body = loadFixture('handmade-classic.html');
    const prose = body.closest('.prose-diff')!;
    const original = prose.outerHTML;
    expect(applyBody(body)).toEqual({ folds: 2, tables: 0, errors: [] });
    const once = prose.outerHTML;
    applyBody(body);
    expect(prose.outerHTML).toBe(once);
    body.querySelector<HTMLElement>('[data-mdf="file-toolbar"] button')!.click();
    undoAll(document);
    expect(prose.outerHTML).toBe(original);
  });
});

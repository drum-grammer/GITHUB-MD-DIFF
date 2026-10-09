import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyBody } from '../src/apply';
import { syncFileToolbar } from '../src/controls';
import { changeTargets, installNavKeys, jump, summaryOf } from '../src/nav';
import { loadFixture } from './helpers';

function body(html: string): HTMLElement {
  document.body.innerHTML = `<div class="prose-diff"><div class="markdown-body">${html}</div></div>`;
  return document.querySelector<HTMLElement>('.markdown-body')!;
}

const texts = (els: HTMLElement[]) => els.map((e) => (e.textContent ?? '').trim());

describe('changeTargets — 바뀐 곳', () => {
  it('이어진 바뀐 블록은 한 곳, 문맥(.vicinity)·변경 없는 블록·접기 막대는 끊는다', () => {
    const b = body(
      '<p class="vicinity">앞</p>' +
        '<del><p>지운 문단</p></del>' +
        '<div data-mdf="thread"><del>코멘트 안 취소선</del></div>' + // 스레드 상자는 건너뛴다
        '<div class="changed"><pre>코드</pre></div>' +
        '<p class="vicinity">사이</p>' +
        '<ul><li class="added">새 항목</li></ul>' +
        '<button data-mdf="fold">변경 없음</button><p class="unchanged mdf-hidden">숨긴 문단</p>' +
        '<section class="footnotes changed"><ol><li>각주</li></ol></section>',
    );
    expect(texts(changeTargets(b))).toEqual(['지운 문단', '새 항목', '각주']);
  });

  it('확장이 만든 것은 합친 표만 — 바뀐 행이 있을 때. 그 뒤 숨긴 원래 표는 묶음을 끊지 않는다', () => {
    const b = body(
      '<div data-mdf="table"><table><tr class="mdf-row-same"><td>같음</td></tr><tr class="mdf-row-changed"><td>표</td></tr></table></div>' +
        '<del class="mdf-hidden"><table><tr><td>옛</td></tr></table></del><ins class="mdf-hidden"><table><tr><td>새</td></tr></table></ins>' +
        '<div class="changed"><p>바로 뒤 문단</p></div>' +
        '<div data-mdf="table"><table><tr class="mdf-row-same"><td>안 바뀐 합친 표</td></tr></table></div>' +
        '<div data-mdf="thread"><ins>코멘트의 밑줄</ins></div>',
    );
    expect(changeTargets(b)).toHaveLength(1);
    expect(changeTargets(b)[0].getAttribute('data-mdf')).toBe('table');
  });

  it('손으로 만든 PR 본문 — 고친 문단과 합친 표 두 곳(사이 문맥·빈 묶음이 끊는다)', () => {
    const b = loadFixture('handmade-prose.html');
    applyBody(b);
    expect(changeTargets(b).map((e) => e.getAttribute('data-mdf') ?? e.className)).toEqual(['changed rich-diff-level-zero', 'table']);
  });
});

describe('summaryOf — 파일 툴바 요약', () => {
  it('바뀐 곳 수, 스레드가 있으면 스레드 수와 미해결 수', () => {
    const b = body('<div class="changed"><p>a</p></div><p class="vicinity">b</p><ins><p>c</p></ins>');
    expect(summaryOf(b)).toBe('navChanges:2');
    b.insertAdjacentHTML('beforeend', '<div data-mdf="thread" data-resolved="false"></div><div data-mdf="thread" data-resolved="true"></div>');
    expect(summaryOf(b)).toBe('navChanges:2 · navThreads:2|1');
  });

  it('하나면 단수 문구, 바뀐 곳이 없으면 null', () => {
    const b = body('<ins><p>a</p></ins><div data-mdf="thread" data-resolved="true"></div>');
    expect(summaryOf(b)).toBe('navChangesOne · navThreadsOne:0');
    expect(summaryOf(body('<p class="vicinity">a</p><p class="unchanged">b</p>'))).toBeNull();
  });
});

describe('syncFileToolbar', () => {
  it('접을 것이 없어도 바뀐 곳이 있으면 요약과 이전·다음 버튼만(모두 펼치기 없음)', () => {
    const b = body('<div class="changed"><p>x</p></div>');
    expect(syncFileToolbar(b)).toBe(true);
    const bar = b.querySelector('[data-mdf="file-toolbar"]')!;
    expect(bar.querySelector('.mdf-expand')).toBeNull();
    expect(bar.querySelector('.mdf-summary')?.textContent).toBe('navChangesOne');
    expect(bar.querySelectorAll('.mdf-nav')).toHaveLength(2);
  });

  it('모두 펼치기는 첫 버튼, 바뀐 것이 없으면 DOM을 건드리지 않고, 스레드가 붙으면 요약만 고친다', async () => {
    const b = loadFixture('handmade-prose.html');
    applyBody(b);
    const bar = b.querySelector('[data-mdf="file-toolbar"]')!;
    expect(bar.querySelector('button')?.classList.contains('mdf-expand')).toBe(true);
    expect(bar.querySelector('.mdf-summary')?.textContent).toBe('navChanges:2');

    const records: MutationRecord[] = [];
    const mo = new MutationObserver((r) => records.push(...r));
    mo.observe(b, { childList: true, subtree: true, characterData: true });
    syncFileToolbar(b);
    await Promise.resolve();
    expect(records).toHaveLength(0); // 본문이 바뀔 때마다 불리므로 같으면 쓰지 않는다(쓰면 다시 불려 끝없이 돈다)

    b.querySelector('.changed')!.insertAdjacentHTML('afterend', '<div data-mdf="thread" data-resolved="false"></div>');
    syncFileToolbar(b);
    mo.disconnect();
    expect(bar.querySelector('.mdf-summary')?.textContent).toBe('navChanges:2 · navThreadsOne:1');
    expect(b.querySelectorAll('[data-mdf="file-toolbar"]')).toHaveLength(1);
  });

  it('바뀐 곳도 접을 것도 없으면 툴바를 달지 않는다', () => {
    const b = body('<p class="vicinity">a</p>');
    expect(syncFileToolbar(b)).toBe(false);
    expect(b.querySelector('[data-mdf]')).toBeNull();
  });
});

/**
 * jsdom은 배치가 없다 — 블록마다 페이지 위치(y)를 주고, 스크롤(scrollY)과 scrollIntoView를 흉내 낸다.
 * scrollIntoView는 scroll-margin-top(화면 30%)만큼 띄워 맞추고, 페이지 끝에서는 더 못 내려간다
 */
function fakePage(els: HTMLElement[], ys: number[], pageHeight: number) {
  const view = { scrollY: 0 };
  const ref = window.innerHeight * 0.3;
  const maxScroll = pageHeight - window.innerHeight;
  const yOf = new Map(els.map((e, i) => [e, ys[i]]));
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    return (yOf.has(this as HTMLElement) ? [{}] : []) as unknown as DOMRectList;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const y = yOf.get(this as HTMLElement) ?? 0;
    return { top: y - view.scrollY } as DOMRect;
  });
  Element.prototype.scrollIntoView = function (this: Element) {
    const y = yOf.get(this as HTMLElement) ?? 0;
    view.scrollY = Math.max(0, Math.min(maxScroll, y - ref));
  };
  return view;
}

const statusText = () => document.querySelector('[data-mdf="nav-status"]')?.textContent;

describe('jump — 다음·이전 바뀐 곳', () => {
  let b: HTMLElement;
  let view: { scrollY: number };
  beforeEach(() => {
    vi.useFakeTimers();
    b = body('<ins><p>1</p></ins><p class="vicinity">a</p><ins><p>2</p></ins><p class="vicinity">b</p><ins><p>3</p></ins><p class="vicinity">c</p><ins><p>4</p></ins>');
    const ins = [...b.querySelectorAll<HTMLElement>(':scope > ins')];
    view = fakePage(ins, [400, 1200, 2400, 2700], 3000); // 마지막 둘은 페이지 끝이라 화면 30%까지 못 올라온다
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('차례로 내려가고, 페이지 끝에서도 다음으로 넘어가며, 끝에서는 안내만', () => {
    expect(jump(document, 'change', 1)).toBe(true);
    expect(statusText()).toBe('navAtChange:1|4');
    expect(jump(document, 'change', 1)).toBe(true);
    expect(statusText()).toBe('navAtChange:2|4');
    expect(jump(document, 'change', 1)).toBe(true); // 끝 근처 — 화면 30%에 못 와도 이어서
    expect(jump(document, 'change', 1)).toBe(true);
    expect(statusText()).toBe('navAtChange:4|4');
    expect(jump(document, 'change', 1)).toBe(false);
    expect(statusText()).toBe('navLastChange');
    expect(jump(document, 'change', -1)).toBe(true);
    expect(statusText()).toBe('navAtChange:3|4');
  });

  it('간 곳이 몇 px 밀려도(GitHub가 아래를 마저 그림) 같은 곳으로 다시 가지 않는다', () => {
    jump(document, 'change', 1);
    view.scrollY -= 20; // 위쪽 내용이 늘어 간 곳이 20px 내려간 것과 같다
    expect(jump(document, 'change', 1)).toBe(true);
    expect(statusText()).toBe('navAtChange:2|4');
  });

  it('사람이 화면을 움직였으면 지금 화면 기준으로 찾는다', () => {
    jump(document, 'change', 1);
    view.scrollY = 1100; // 직접 스크롤 — 2번이 화면 위쪽(100px)에 있다
    expect(jump(document, 'change', 1)).toBe(true);
    expect(statusText()).toBe('navAtChange:3|4');
    view.scrollY = 0;
    expect(jump(document, 'change', -1)).toBe(false);
    expect(statusText()).toBe('navFirstChange');
  });

  it('간 곳을 잠깐 비춘다(감싼 <ins>는 안의 첫 블록)', () => {
    jump(document, 'change', 1);
    const p = b.querySelector('ins > p')!;
    expect(p.classList.contains('mdf-flash')).toBe(true);
    vi.advanceTimersByTime(1300);
    expect(p.classList.contains('mdf-flash')).toBe(false);
  });

  it('파일 툴바의 ↓는 누른 버튼 아래의 첫 바뀐 곳으로(화면 30% 선보다 위여도)', () => {
    const button = document.createElement('button');
    // vi.spyOn을 쓰면 이미 가로챈 Element.prototype 쪽을 바꿔 버린다 — 이 버튼에만 둔다
    Object.defineProperty(button, 'getBoundingClientRect', { value: () => ({ bottom: 150 }) as DOMRect });
    view.scrollY = 1000; // 2번(1200)이 화면 200px — 30% 선(230)보다 위라 ]로는 3번으로 간다
    const went = jump(document, 'change', 1, b, button);
    expect(statusText()).toBe('navAtChange:2|4');
    expect(went).toBe(true);
    expect(statusText()).toBe('navAtChange:2|4');
  });

  it('스레드가 없으면 안내만', () => {
    expect(jump(document, 'thread', 1)).toBe(false);
    expect(statusText()).toBe('navNoThreads');
  });
});

describe('installNavKeys', () => {
  let calls: string[];
  let active = true;
  beforeEach(() => {
    calls = [];
    active = true;
    body('<ins><p>1</p></ins><textarea></textarea>');
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
  });
  afterEach(() => vi.restoreAllMocks());

  const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    if (e.defaultPrevented) calls.push(key);
  };

  it('] [ } { 만 가로채고, 입력란·수정키·꺼짐·렌더링 없음일 때는 그대로 둔다', () => {
    installNavKeys(document, () => active);
    press(']');
    press('[');
    press('}');
    press('{');
    press('j');
    press(']', { metaKey: true });
    press(']', {}, document.querySelector('textarea')!);
    active = false;
    press(']');
    active = true;
    document.querySelector('.prose-diff')!.remove(); // 렌더링 본문이 없는 화면(원문 보기만)
    press(']');
    expect(calls).toEqual([']', '[', '}', '{']);
  });
});

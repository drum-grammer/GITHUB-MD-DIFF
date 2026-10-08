import { describe, expect, it } from 'vitest';
import { foldBars, foldUnchanged, refold, setFoldExpanded } from '../src/fold';
import { PIN_ATTR } from '../src/selectors';

function body(): HTMLElement {
  document.body.innerHTML =
    '<div class="prose-diff"><div><div class="markdown-body">' +
    '<p class="unchanged" id="a">a</p><p class="unchanged" id="b">b</p><p class="unchanged" id="c">c</p>' +
    '<p class="changed">바뀜</p></div></div></div>';
  return document.querySelector<HTMLElement>('.markdown-body')!;
}

describe('refold', () => {
  it('고정한 블록에서 묶음을 나누고, 펼쳐 둔 묶음은 펼친 채로', () => {
    const b = body();
    foldUnchanged(b);
    setFoldExpanded(foldBars(b)[0], true);
    refold(b, () => {
      b.querySelector('#b')!.setAttribute(PIN_ATTR, '');
      const x = document.createElement('div');
      x.setAttribute('data-mdf', 'thread');
      b.querySelector('#b')!.after(x);
    });
    const bars = foldBars(b);
    expect(bars).toHaveLength(2);
    expect(bars.every((x) => x.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect(b.querySelector('#b')!.classList.contains('mdf-hidden')).toBe(false);
  });

  it('접혀 있던 묶음은 다시 접힌다', () => {
    const b = body();
    foldUnchanged(b);
    refold(b, () => b.querySelector('#b')!.setAttribute(PIN_ATTR, ''));
    expect(b.querySelector('#a')!.classList.contains('mdf-hidden')).toBe(true);
    expect(b.querySelector('#c')!.classList.contains('mdf-hidden')).toBe(true);
    expect(b.querySelector('#b')!.classList.contains('mdf-hidden')).toBe(false);
  });
});

describe('코멘트가 붙은 GitHub 묶음(div.expandable.unchanged)', () => {
  function grouped(): HTMLElement {
    const ps = Array.from({ length: 8 }, (_, k) => `<p class="unchanged" id="p${k}">p${k}</p>`).join('');
    document.body.innerHTML =
      '<div class="prose-diff"><div><div class="markdown-body">' +
      '<h1 class="vicinity">제목</h1>' +
      `<div class="expandable unchanged js-expandable" id="g"><h2>절</h2><a class="anchor" href="#x"></a>${ps}</div>` +
      '<div class="changed"><p>바뀜</p></div></div></div></div>';
    return document.querySelector<HTMLElement>('.markdown-body')!;
  }

  it('묶음째 펼치지 않고, 고정한 블록 앞뒤를 묶음 안에서 접는다', () => {
    const b = grouped();
    foldUnchanged(b);
    expect(foldBars(b)).toHaveLength(1);
    refold(b, () => {
      const g = b.querySelector('#g')!;
      g.setAttribute(PIN_ATTR, '');
      b.querySelector('#p4')!.setAttribute(PIN_ATTR, '');
      const box = document.createElement('div');
      box.setAttribute('data-mdf', 'thread');
      b.querySelector('#p4')!.after(box);
    });
    const bars = foldBars(b);
    expect(bars).toHaveLength(2);
    expect(bars.every((bar) => bar.parentElement?.id === 'g')).toBe(true);
    expect(b.querySelector('#g')!.classList.contains('mdf-hidden')).toBe(false);
    expect(b.querySelector('#p4')!.classList.contains('mdf-hidden')).toBe(false);
    for (const id of ['p0', 'p3', 'p5', 'p7']) expect(b.querySelector(`#${id}`)!.classList.contains('mdf-hidden')).toBe(true);
    expect(b.querySelector('[data-mdf="thread"]')!.classList.contains('mdf-hidden')).toBe(false);
  });

  it('묶음 안 막대도 펼치고 접히며, 다시 짜도 숨은 채 남는 것이 없다', () => {
    const b = grouped();
    foldUnchanged(b);
    const pinIt = () => {
      b.querySelector('#g')!.setAttribute(PIN_ATTR, '');
      b.querySelector('#p4')!.setAttribute(PIN_ATTR, '');
    };
    refold(b, pinIt);
    const [first] = foldBars(b);
    setFoldExpanded(first, true);
    expect(b.querySelector('#p0')!.classList.contains('mdf-hidden')).toBe(false);
    refold(b, () => {});
    expect(foldBars(b)[0].getAttribute('aria-expanded')).toBe('true');
    expect(b.querySelector('#p0')!.classList.contains('mdf-hidden')).toBe(false);
    expect(b.querySelector('#p7')!.classList.contains('mdf-hidden')).toBe(true);
    for (const bar of foldBars(b)) setFoldExpanded(bar, true);
    expect(b.querySelectorAll('.mdf-hidden')).toHaveLength(0);
  });
});

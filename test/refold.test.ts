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

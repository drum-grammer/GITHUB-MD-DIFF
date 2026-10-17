import { describe, expect, it } from 'vitest';
import { fragment } from '../src/dom';
import { invisibleChars, leafKey, topKey, visibleText } from '../src/keys';

const el = (html: string): HTMLElement => fragment(html).firstElementChild as HTMLElement;

describe('leafKey — 렌더링으로 판정(원문 아님)', () => {
  it('공백은 하나로, 태그 이름은 키에 든다(h2 → h3은 바뀜)', () => {
    expect(leafKey(el('<p>a  b\nc</p>'), 'paragraph')).toBe(leafKey(el('<p>a b c</p>'), 'paragraph'));
    expect(leafKey(el('<h2>T</h2>'), 'heading')).not.toBe(leafKey(el('<h3>T</h3>'), 'heading'));
  });

  it('목록 항목은 자기 글만 — 안쪽 목록은 빼고, 느슨한 목록의 문단 껍데기를 벗긴다', () => {
    expect(leafKey(el('<li><p>own</p><ul><li>inner</li></ul></li>'), 'item')).toBe(leafKey(el('<li>own</li>'), 'item'));
  });

  it('표 행은 칸 안쪽만 — 칸 정렬(align)은 표 전체 비교가 잡는다', () => {
    expect(leafKey(el('<table><tr><td align="center">1</td></tr></table>').querySelector('tr')!, 'row')).toBe(leafKey(el('<table><tr><td>1</td></tr></table>').querySelector('tr')!, 'row'));
  });

  it('코드는 info string과 들여쓰기를 지킨다, 줄 끝 공백만 지운다', () => {
    const a = el('<pre><code class="language-py">if x:\n  y()   \n</code></pre>');
    expect(leafKey(a, 'code')).toBe(leafKey(el('<pre><code class="language-py">if x:\n  y()\n</code></pre>'), 'code'));
    expect(leafKey(a, 'code')).not.toBe(leafKey(el('<pre><code class="language-py">if x:\n    y()\n</code></pre>'), 'code'));
    expect(leafKey(a, 'code')).not.toBe(leafKey(el('<pre><code class="language-sh">if x:\n  y()\n</code></pre>'), 'code'));
  });

  it('속성도 비교한다 — href만 바뀌어도 키가 다르고, 보이는 글은 같다(invisible)', () => {
    const a = el('<p><a href="https://a.example">docs</a></p>');
    const b = el('<p><a href="https://b.example">docs</a></p>');
    expect(leafKey(a, 'paragraph')).not.toBe(leafKey(b, 'paragraph'));
    expect(visibleText(a, 'paragraph')).toBe(visibleText(b, 'paragraph'));
  });
});

describe('visibleText·invisibleChars', () => {
  it('폭 없는 문자·양방향 제어 문자는 보이는 글에서 빠지고, 원문에서는 따로 모인다', () => {
    expect(visibleText(el('<p>a\u200Bb</p>'), 'paragraph')).toBe('ab');
    expect(invisibleChars('pay \u202E001\u202C now')).toBe('\u202E\u202C');
  });

  it('코드는 들여쓰기가 보이는 글이다', () => {
    expect(visibleText(el('<pre><code>  x</code></pre>'), 'code')).not.toBe(visibleText(el('<pre><code>    x</code></pre>'), 'code'));
  });
});

describe('topKey — 블록 HTML 전체', () => {
  it('제목 앵커와 순서 목록 시작 번호는 무시한다', () => {
    expect(topKey(fragment('<h1>T</h1><a class="anchor" href="#t-1"></a>'))).toBe(topKey(fragment('<h1>T</h1><a class="anchor" href="#t"></a>')));
    expect(topKey(fragment('<ol start="3"><li>a</li></ol>'))).toBe(topKey(fragment('<ol><li>a</li></ol>')));
  });

  it('<pre> 안 공백은 지킨다', () => {
    expect(topKey(fragment('<pre>a  b</pre>'))).not.toBe(topKey(fragment('<pre>a b</pre>')));
  });
});

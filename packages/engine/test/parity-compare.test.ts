import { describe, expect, it } from 'vitest';
import { fragment } from '../src/dom';
import { compare, parityBlocks } from '../parity/compare';

describe('패리티 비교 — (표시, 종류, 정규화 글자)', () => {
  it('블록과 표시 — 지운 것·넣은 것·고친 것·변경 없음(vicinity 포함)', () => {
    const body = fragment('<del><p>gone</p></del><ins><p>new</p></ins><div class="changed"><p>a <ins>b</ins></p></div><p class="vicinity">ctx</p><div class="changed mdc-source-only"><pre>x</pre></div>');
    expect(parityBlocks(body)).toEqual([
      { mark: 'removed', kind: 'paragraph', text: 'gone' },
      { mark: 'added', kind: 'paragraph', text: 'new' },
      { mark: 'changed', kind: 'paragraph', text: 'ab' },
      { mark: 'unchanged', kind: 'paragraph', text: 'ctx' },
    ]);
  });

  it('일치율과 어긋난 목록 — 표시만 다른 것은 따로', () => {
    const g = fragment('<p>one</p><div class="changed"><p>two <ins>x</ins></p></div><p>three</p>');
    const e = fragment('<p>one</p><del><p>two</p></del><ins><p>two x</p></ins><p>four</p>');
    const c = compare(g, e);
    expect(c.matched).toBe(1);
    expect(c.rate).toBeCloseTo(1 / 4);
    expect(c.markOnly).toEqual([[{ mark: 'changed', kind: 'paragraph', text: 'twox' }, { mark: 'added', kind: 'paragraph', text: 'twox' }]]);
    expect(c.onlyGithub.map((b) => b.text)).toEqual(['three']);
    expect(c.onlyEngine.map((b) => b.text)).toEqual(['two', 'four']);
  });
});

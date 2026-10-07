import { describe, expect, it } from 'vitest';
import { MAX_CELLS, alignBlocks, similarity, type AlignItem } from '../src/align';

const p = (text: string): AlignItem => ({ kind: 'paragraph', text });
const h = (text: string): AlignItem => ({ kind: 'heading', text });

describe('alignBlocks', () => {
  it('같은 글끼리 순서대로 맞추고, 원문에만 있는 블록은 건너뛴다', () => {
    expect(alignBlocks([h('개요'), p('둘째')], [h('개요'), p('첫째'), p('둘째')])).toEqual([0, 2]);
  });

  it('종류가 다르면 글이 같아도 맞추지 않는다', () => {
    expect(alignBlocks([h('설치')], [p('설치')])).toEqual([-1]);
  });

  it('조금 다른 글(이모지·자동 링크 차이)은 비슷하면 맞춘다', () => {
    expect(alignBlocks([p('배포 완료 🎉 https://example.com')], [p('배포 완료 :tada: https://example.com')])).toEqual([0]);
  });

  it('너무 다르면 맞추지 않는다', () => {
    expect(alignBlocks([p('전혀 다른 문장입니다')], [p('완전히 새로운 내용이에요')])).toEqual([-1]);
  });

  it('같은 글이 여러 번 나오면 순서를 지킨다', () => {
    expect(alignBlocks([p('같음'), p('사이'), p('같음')], [p('같음'), p('사이'), p('같음')])).toEqual([0, 1, 2]);
  });

  it('아주 긴 문서는 똑같은 것만 앞에서부터 맞춘다', () => {
    const n = Math.ceil(Math.sqrt(MAX_CELLS)) + 1;
    const dom = Array.from({ length: n }, (_, i) => p(`문단 ${i}`));
    const out = alignBlocks(dom, dom);
    expect(out[0]).toBe(0);
    expect(out[n - 1]).toBe(n - 1);
  });
});

describe('similarity', () => {
  it('같으면 1, 짧으면 0', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('a', 'b')).toBe(0);
  });
});

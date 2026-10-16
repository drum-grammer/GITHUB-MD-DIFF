import { describe, expect, it } from 'vitest';
import { GAP_CELLS, MAX_CELLS, alignBlocks, similarity, type AlignItem } from '../src/align';

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

describe('alignBlocks — 한도 인자(AlignOptions)', () => {
  /** 문단 n개 중 5개마다 낱말 하나를 바꾸고, 7개마다 하나를 지우고, 사이에 새 문단을 넣은 판 */
  const corpus = (n: number): [AlignItem[], AlignItem[]] => {
    const old = Array.from({ length: n }, (_, i) => (i % 10 === 0 ? h(`절 ${i}`) : p(`문단 ${i}은 회의에서 정한 내용을 그대로 옮겨 적은 글이다`)));
    const neu: AlignItem[] = [];
    old.forEach((b, i) => {
      if (i % 7 === 3) return;
      neu.push(i % 5 === 1 ? { ...b, text: b.text.replace('그대로', '거의 그대로') } : b);
      if (i % 11 === 4) neu.push(p(`새로 넣은 문단 ${i}`));
    });
    return [neu, old];
  };

  it('기본값을 그대로 넘기면 생략했을 때와 결과가 같다', () => {
    for (const n of [0, 1, 30, 400]) {
      const [dom, src] = corpus(n);
      const want = alignBlocks(dom, src);
      expect(alignBlocks(dom, src, {}), `n=${n}`).toEqual(want);
      expect(alignBlocks(dom, src, { gapCells: GAP_CELLS, maxCells: MAX_CELLS }), `n=${n}`).toEqual(want);
    }
  });

  it('gapCells보다 큰 틈에서는 비슷한 짝을 찾지 않는다', () => {
    const dom = [h('A'), p('the quick brown fox jumps over the dog'), h('B')];
    const src = [h('A'), p('the quick brown fox jumped over the dog'), h('B')];
    expect(alignBlocks(dom, src)).toEqual([0, 1, 2]);
    expect(alignBlocks(dom, src, { gapCells: 0 })).toEqual([0, -1, 2]);
  });

  it('maxCells를 넘으면 똑같은 것을 앞으로만 찾는다(최장 공통 부분열과 다른 짝)', () => {
    const dom = [p('alpha'), p('beta')];
    const src = [p('beta'), p('alpha')];
    expect(alignBlocks(dom, src)).toEqual([-1, 0]);
    expect(alignBlocks(dom, src, { maxCells: 3 })).toEqual([1, -1]);
  });

  it('kind는 아무 문자열이나 받고, 같은 kind끼리만 짝짓는다(로컬 엔진의 각주·머리말)', () => {
    expect(alignBlocks([{ kind: 'footnote', text: '출처 메모' }], [{ kind: 'item', text: '출처 메모' }])).toEqual([-1]);
    expect(alignBlocks([{ kind: 'footnote', text: '출처 메모' }], [{ kind: 'footnote', text: '출처 메모' }])).toEqual([0]);
  });
});

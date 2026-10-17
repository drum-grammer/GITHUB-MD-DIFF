import { describe, expect, it } from 'vitest';
import { GAP_CELLS, MAX_CELLS, alignBlocks } from '../../../src/align';
import { ENGINE_GAP_CELLS, alignLeaves } from '../src/pair';

const items = (kind: string, n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => ({ kind, text: f(i) }));
const ext = { gapCells: GAP_CELLS, maxCells: MAX_CELLS };

describe('alignLeaves — 옛 ↔ 새 잎', () => {
  it('글자가 같은 잎이 기준점, 사이 틈에서 비슷한(0.6 이상) 잎끼리', () => {
    const olds = [{ kind: 'heading', text: 'Intro' }, { kind: 'paragraph', text: 'The quick brown fox jumps' }, { kind: 'paragraph', text: 'Gone entirely' }];
    const news = [{ kind: 'heading', text: 'Intro' }, { kind: 'paragraph', text: 'The quick brown fox leaps' }];
    expect(alignLeaves(news, olds, ext)).toEqual([0, 1]);
  });

  it('종류가 다르면 짝짓지 않는다 — 각주(footnote)·머리말(meta)은 목록 항목·표 행과 섞이지 않는다', () => {
    expect(alignLeaves([{ kind: 'footnote', text: 'Same text here' }], [{ kind: 'item', text: 'Same text here' }], ext)).toEqual([-1]);
    expect(alignLeaves([{ kind: 'meta', text: 'title Lantern' }], [{ kind: 'row', text: 'title Lantern' }], ext)).toEqual([-1]);
  });

  it('문단 200개가 각각 한 낱말씩 바뀌면 — 확장 alignBlocks 기본 한도(20,000칸)로는 짝이 없고, 엔진 한도로는 모두 짝', () => {
    const olds = items('paragraph', 200, (i) => `Paragraph ${i} keeps most of its words but changes alpha`);
    const news = items('paragraph', 200, (i) => `Paragraph ${i} keeps most of its words but changes beta`);
    expect(alignBlocks(news, olds).filter((j) => j >= 0)).toHaveLength(0);
    expect(alignLeaves(news, olds, { gapCells: ENGINE_GAP_CELLS, maxCells: MAX_CELLS })).toEqual(news.map((_, i) => i));
  });

  it('엔진 한도도 넘는 틈은 제목 경계로 쪼개 다시 맞춘다', () => {
    const section = (h: string, tag: string) => [{ kind: 'heading', text: h }, ...items('paragraph', 30, (i) => `${h} paragraph ${i} with filler words ${tag}`)];
    const olds = [...section('Alpha', 'old'), ...section('Beta', 'old')];
    const news = [...section('Alpha', 'new'), ...section('Beta', 'new')];
    const got = alignLeaves(news, olds, { gapCells: 100, maxCells: MAX_CELLS });
    expect(got).toEqual(news.map((_, i) => i));
  });

  it('제목도 없으면 같은 종류 같은 개수를 차례대로 1:1, Dice 0.6 미만은 푼다', () => {
    const olds = [...items('paragraph', 20, (i) => `Line ${i} of the long section text`), { kind: 'paragraph', text: 'zzzz qqqq' }];
    const news = [...items('paragraph', 20, (i) => `Line ${i} of the long section words`), { kind: 'paragraph', text: 'completely different words' }];
    const got = alignLeaves(news, olds, { gapCells: 10, maxCells: MAX_CELLS });
    expect(got.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(got[20]).toBe(-1);
  });

  // Review Focus 4 — 에이전트가 긴 절의 모든 문단을 조금씩 고친 경우(제목 없음, 엔진 한도도 넘음)
  it('제목 없는 문단 600개가 각각 조금씩 — 같은 개수 1:1로 모두 짝', () => {
    const olds = items('paragraph', 600, (i) => `Clause ${i}: the service keeps logs for thirty days by default`);
    const news = items('paragraph', 600, (i) => `Clause ${i}: the service keeps logs for ninety days by default`);
    expect(alignLeaves(news, olds, { gapCells: ENGINE_GAP_CELLS, maxCells: MAX_CELLS })).toEqual(news.map((_, i) => i));
  });

  it('제목 없는 문단 600개가 조금씩 + 가운데 한 문단 추가 — 개수가 달라도 띠 안에서 짝', () => {
    const olds = items('paragraph', 600, (i) => `Clause ${i}: the service keeps logs for thirty days by default`);
    const news = olds.map((o) => ({ ...o, text: o.text.replace('thirty', 'ninety') }));
    news.splice(300, 0, { kind: 'paragraph', text: 'A brand new clause about retention exceptions' });
    const got = alignLeaves(news, olds, { gapCells: ENGINE_GAP_CELLS, maxCells: MAX_CELLS });
    expect(got[300]).toBe(-1);
    expect(got.filter((j) => j >= 0)).toHaveLength(600);
  });
});

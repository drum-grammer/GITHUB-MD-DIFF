import { writeFileSync, mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diffMarkdown, renderProseDiff } from '../src/index';
import { ENGINE_GAP_CELLS } from '../src/pair';

/**
 * 짝짓기 한도(gapCells)를 정한 근거 — 제목 없는 긴 절에서 문단 N개가 각각 한 낱말씩 바뀌고 가운데에 문단 하나가 더해진 문서를 한도마다 잰다.
 * 제목 기준점이 없어 틈 하나가 N×N칸이다(한도를 넘는 길을 탄다). 결과는 .scratch/perf/align.md(보고서용). 기본값 ENGINE_GAP_CELLS는 이 표에서 골랐다
 */
const doc = (n: number, word: string, insertAt = -1): string => {
  const ps = Array.from({ length: n }, (_, i) => `Paragraph ${i} keeps most of its words but changes ${word}.`);
  if (insertAt >= 0) ps.splice(insertAt, 0, 'An extra paragraph the agent added in the middle.');
  return ps.join('\n\n') + '\n';
};

function time(n: number, gapCells: number): { ms: number; changed: number; added: number; removed: number } {
  const t0 = performance.now();
  const d = diffMarkdown({ oldText: doc(n, 'alpha'), newText: doc(n, 'beta', Math.floor(n / 2)), path: 'a.md' }, { gapCells });
  renderProseDiff(d, { rev: 'p', imageId: () => null });
  const count = (op: string) => d.blocks.filter((b) => b.op === op).length;
  return { ms: performance.now() - t0, changed: count('changed'), added: count('added'), removed: count('removed') };
}

describe('짝짓기 한도 시간 측정', () => {
  it('한도마다 문단 200·1,000개', () => {
    const rows: string[] = ['| gapCells | 문단 | 시간(ms) | 고친 블록 | 추가 | 삭제 |', '|---:|---:|---:|---:|---:|---:|'];
    for (const gapCells of [20_000, 250_000, 1_000_000]) {
      for (const n of [200, 1000]) {
        const r = time(n, gapCells);
        rows.push(`| ${gapCells.toLocaleString('en')} | ${n} | ${r.ms.toFixed(0)} | ${r.changed} | ${r.added} | ${r.removed} |`);
      }
    }
    mkdirSync('.scratch/perf', { recursive: true });
    writeFileSync('.scratch/perf/align.md', rows.join('\n') + '\n');
    expect(rows.length).toBe(8);
  });

  it('기본 한도로 문단 1,000개 + 한 문단 추가 — 모두 고침(지움+추가 아님), 15초 안', () => {
    const r = time(1000, ENGINE_GAP_CELLS);
    expect(r).toMatchObject({ changed: 1000, added: 1, removed: 0 });
    expect(r.ms).toBeLessThan(15_000);
  });
});

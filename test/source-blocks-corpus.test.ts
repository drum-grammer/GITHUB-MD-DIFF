// markdown-it을 올려도(14 → 15) 원문 블록 나누기가 그대로인지 — 결과를 파일 스냅숏으로 고정한다(markdown-it 14, ffc671e에서 처음 만듦).
// src/source-blocks.ts나 markdown-it을 바꿔 다르게 나오면 원문 줄 연결이 바뀐 것이니 까닭부터 찾는다. testbed/scenarios.ts(문서 내용)만 고쳐서 다르면 `pnpm test -u test/source-blocks-corpus.test.ts`로 새로 쓴다
import { describe, expect, it } from 'vitest';
import { sourceBlocks } from '../src/source-blocks';
import { SCENARIOS, baseFiles, headFiles } from '../testbed/scenarios';

/** 손으로 만든 문서 — testbed 문서에 없는 문법(각주·할 일·HTML 블록·수식·정의·CRLF·이스케이프)을 한 곳에 */
const KITCHEN_SINK = [
  'Setext title',
  '============',
  '',
  'Intro with a footnote[^1] and a [reference link][d].',
  '',
  '- [x] done task',
  '- [ ] open task',
  '  - nested item',
  '    continued line',
  '',
  '1. first',
  '2. second',
  '',
  '> quoted paragraph',
  '>',
  '> second quoted paragraph',
  '',
  '> [!WARNING]',
  '> Alert body line.',
  '',
  '| Key | Value |',
  '|:---:|---|',
  '| pipe | a \\| b |',
  '',
  '<details>',
  '<summary>More</summary>',
  '',
  'Hidden paragraph.',
  '',
  '</details>',
  '',
  '<div align="center"><img src="badge.svg" alt="badge"></div>',
  '',
  '<!-- a hidden comment -->',
  '',
  '$$',
  'x^2',
  '',
  'y^2',
  '$$',
  '',
  '    indented code',
  '',
  '---',
  '',
  'Line with two trailing spaces  ',
  'and a hard break.',
  '',
  '[d]: https://example.com/docs',
  '[^1]: The footnote text.',
  '',
].join('\r\n');

function corpus(): Record<string, string> {
  const out: Record<string, string> = { 'handmade:kitchen-sink.md': KITCHEN_SINK };
  // docs/large.md(2,400문단)와 many/(같은 모양 100개)는 반복이라 뺀다
  const isDoc = (path: string) => /\.(md|mdx)$/.test(path) && path !== 'docs/large.md' && !path.startsWith('many/');
  for (const [path, text] of Object.entries(baseFiles())) if (isDoc(path)) out[`base:${path}`] = text;
  for (const s of SCENARIOS) for (const [path, text] of Object.entries(headFiles(s.key))) if (isDoc(path)) out[`${s.key}:${path}`] = text;
  return out;
}

describe('sourceBlocks — 고정 문서 모음', () => {
  it('testbed 문서와 손으로 만든 문서의 블록(종류·줄·글·각주 차례)이 스냅숏과 같다', async () => {
    const out = Object.fromEntries(
      Object.entries(corpus()).map(([key, text]) => [key, sourceBlocks(text).map((b) => [b.kind, b.start, b.end, b.text, b.footnote ?? null])]),
    );
    await expect(`${JSON.stringify(out, null, 1)}\n`).toMatchFileSnapshot('./__snapshots__/source-blocks-corpus.json');
  });
});

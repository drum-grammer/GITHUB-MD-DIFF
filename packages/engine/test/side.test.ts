import { describe, expect, it } from 'vitest';
import { buildSide, LEAF_ATTR } from '../src/side';

const md = (...xs: string[]): string => xs.join('\n') + '\n';
const view = (src: string) => {
  const s = buildSide(src);
  return {
    tops: s.tops.map((t) => `${t.tokenType} ${t.range.start}-${t.range.end} [${t.leaves.join(',')}]`),
    leaves: s.leaves.map((l) => `${l.kind} ${l.range.start}-${l.range.end} ${l.el?.tagName ?? '-'}`),
    side: s,
  };
};

describe('buildSide — 최상위 블록과 잎(파서 둘)', () => {
  it('잎은 sourceBlocks, 최상위 블록은 렌더링 파서 토큰 — 줄 범위로 잇는다', () => {
    const v = view(md('# Title', '', 'Para.', '', '- a', '- b', '  - c'));
    expect(v.tops).toEqual(['heading_open 1-1 [0]', 'paragraph_open 3-3 [1]', 'bullet_list_open 5-7 [2,3,4]']);
    expect(v.leaves).toEqual(['heading 1-1 H1', 'paragraph 3-3 P', 'item 5-5 LI', 'item 6-6 LI', 'item 7-7 LI']);
  });

  it('머리말 — 키마다 meta 잎, 렌더링은 키·값 표', () => {
    const v = view(md('---', 'title: Lantern', 'tags:', '  - a', '---', '', 'Body.'));
    expect(v.tops[0]).toBe('front_matter 1-5 [0,1]');
    expect(v.leaves.slice(0, 2)).toEqual(['meta 2-2 TR', 'meta 3-4 TR']);
    expect(v.side.tops[0].container.querySelector('tr')!.textContent).toBe('titleLantern');
  });

  it('알림 — 제목 잎과 본문 잎이 알림 블록 하나에 든다', () => {
    const v = view(md('> [!NOTE]', '> Body text.'));
    expect(v.tops).toEqual(['alert_open 1-2 [0,1]']);
    expect(v.side.leaves[0].el!.className).toBe('markdown-alert-title');
  });

  it('수식 블록 — 기본 파서의 문단 잎(빈 줄이면 둘)을 버리고 의사 잎 math 하나', () => {
    const v = view(md('$$', 'a', '', 'b', '$$'));
    expect(v.tops).toEqual(['math_block 1-5 [0]']);
    expect(v.leaves).toEqual(['math 1-5 P']);
  });

  it('잎이 없는 블록 — hr·HTML(배지·<details>·주석)은 의사 잎', () => {
    const v = view(md('---', '', '<div align="center"><img src="b.svg"></div>', '', '<!-- note -->'));
    expect(v.leaves).toEqual(['hr 1-1 HR', 'html 3-3 DIV', 'html 5-5 -']);
  });

  it('어느 블록에도 안 드는 줄(링크 참조 정의) — definition 의사 잎, 렌더링 없음', () => {
    const v = view(md('See [x][d].', '', '[d]: https://example.com', '[e]: https://example.org'));
    expect(v.tops).toEqual(['paragraph_open 1-1 [0]', 'definition 3-4 [1]']);
    expect(v.leaves[1]).toBe('definition 3-4 -');
  });

  it('HTML 블록 안 표 행도 잎 — 렌더링 tr과 짝지어진다', () => {
    const v = view(md('<table>', '  <tr><td>A</td></tr>', '  <tr><td>B</td></tr>', '</table>'));
    expect(v.leaves).toEqual(['row 2-2 TR', 'row 3-3 TR']);
  });

  it('각주 — 본문 잎과 따로, 렌더링 차례대로. 가리키지 않은 정의는 렌더링 없이 끝에', () => {
    const s = buildSide(md('A[^b] B[^a].', '', '[^a]: Note A.', '', '[^b]: Note B.', '', '[^z]: Unused.'));
    expect(s.footnotes.map((f) => [f.label, f.footnote, f.el?.tagName ?? null])).toEqual([
      ['b', 0, 'LI'],
      ['a', 1, 'LI'],
      ['z', -1, null],
    ]);
    expect(s.footnotes[0].el!.id).toBe('user-content-fn-b');
  });

  it('제목 경로 — 앞 제목들의 경로(같거나 깊은 단계는 닫는다)', () => {
    const s = buildSide(md('# A', '', '## B', '', 'x', '', '## C', '', 'y'));
    expect(s.leaves.map((l) => l.headingPath)).toEqual([[], ['A'], ['A', 'B'], ['A'], ['A', 'C']]);
  });

  it('잎 요소에 내부 번호 속성을 단다(최종 HTML에서는 지운다)', () => {
    const s = buildSide(md('Para.'));
    expect(s.leaves[0].el!.getAttribute(LEAF_ATTR)).toBe('0');
  });

  it('과제 상자 id는 지운다 — 앞에 항목이 늘어도 렌더링 비교가 흔들리지 않게', () => {
    const s = buildSide(md('- [ ] a'));
    expect(s.tops[0].container.querySelector('input')!.hasAttribute('id')).toBe(false);
  });

  it('CRLF 원문도 같은 줄 번호', () => {
    expect(view('# a\r\n\r\nb\r\n').leaves).toEqual(['heading 1-1 H1', 'paragraph 3-3 P']);
  });
});

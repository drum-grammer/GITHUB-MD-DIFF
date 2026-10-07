import { describe, expect, it } from 'vitest';
import { domBlocks, mapBlocks, spanOf } from '../src/dom-blocks';
import { normalizeText, sourceBlocks } from '../src/source-blocks';

function body(html: string): HTMLElement {
  document.body.innerHTML = `<div class="prose-diff"><div><article class="markdown-body">${html}</article></div></div>`;
  return document.querySelector<HTMLElement>('.markdown-body')!;
}

const view = (b: HTMLElement) => domBlocks(b).map((d) => [d.kind, d.side, normalizeText(d.text)]);

describe('domBlocks', () => {
  it('고친 문단은 새 파일 쪽 — 지운 글자(<del>)는 빼고 읽는다', () => {
    const b = body('<div class="changed"><p>값이 <del>3</del><ins>4</ins>개</p></div>');
    expect(view(b)).toEqual([['paragraph', 'right', '값이4개']]);
  });

  it('블록째 지운 것(<del>·.removed)은 원래 파일 쪽 — 넣은 글자는 빼고 읽는다', () => {
    const b = body('<del><p>지운 문단</p></del><ul class="changed"><li class="removed">옛 항목</li><li class="added">새 항목</li></ul>');
    expect(view(b)).toEqual([
      ['paragraph', 'left', '지운문단'],
      ['item', 'left', '옛항목'],
      ['item', 'right', '새항목'],
    ]);
  });

  it('목록 항목은 자기 글만, 항목 안 문단은 따로 세지 않는다', () => {
    const b = body('<ul><li><p>위</p><ul><li>안쪽</li></ul></li></ul>');
    expect(view(b)).toEqual([
      ['item', 'right', '위'],
      ['item', 'right', '안쪽'],
    ]);
  });

  it('머리말 표 안의 표 행과 확장이 만든 것은 뺀다', () => {
    const b = body(
      '<table><tr><th>versions</th><td><table><tr><td>fpt</td></tr></table></td></tr></table>' +
        '<div data-mdf="table"><table><tr><td>복사본</td></tr></table></div>',
    );
    expect(view(b)).toEqual([['row', 'right', 'versionsfpt']]);
  });
});

describe('mapBlocks', () => {
  it('렌더링 블록마다 원문 줄 — 지운 블록은 원래 파일 줄', () => {
    const b = body('<h1>제목</h1><div class="changed"><p>새 <del>옛</del>글</p></div><del><p>사라진 줄</p></del>');
    const head = sourceBlocks('# 제목\n\n새 글\n');
    const base = sourceBlocks('# 제목\n\n옛 글\n\n사라진 줄\n');
    const map = mapBlocks(domBlocks(b), head, base);
    const [h1, p, gone] = [...b.querySelectorAll('h1, p')] as HTMLElement[];
    expect(map.get(h1)).toEqual({ side: 'right', start: 1, end: 1 });
    expect(map.get(p)).toEqual({ side: 'right', start: 3, end: 3 });
    expect(map.get(gone)).toEqual({ side: 'left', start: 5, end: 5 });
  });

  it('원문이 없는 쪽은 연결하지 않는다', () => {
    const b = body('<del><p>사라진 줄</p></del>');
    expect(mapBlocks(domBlocks(b), sourceBlocks('x'), null).size).toBe(0);
  });
});

describe('spanOf', () => {
  it('같은 쪽 블록의 줄 범위를 합치고, 쪽이 섞이면 null', () => {
    expect(spanOf([{ side: 'right', start: 5, end: 6 }, { side: 'right', start: 2, end: 2 }])).toEqual({ side: 'right', start: 2, end: 6 });
    expect(spanOf([{ side: 'right', start: 1, end: 1 }, { side: 'left', start: 1, end: 1 }])).toBeNull();
  });
});

describe('mapBlocks — 알림·각주·HTML 표(크롤에서 빠지던 것)', () => {
  it('알림 제목·각주 항목·HTML 표 행이 원문 줄에 붙고, 숨은 "Footnotes" 제목은 블록이 아니다', () => {
    const src = [
      '> [!NOTE]', // 1
      '> 꼭 읽어 주세요.', // 2
      '', // 3
      '본문[^1].', // 4
      '', // 5
      '<table>', // 6
      '<tr><td>Host Namespaces</td><td><ul><li><code>spec.hostPID</code></li></ul></td></tr>', // 7
      '</table>', // 8
      '', // 9
      '[^1]: 고마운 분들', // 10
    ].join('\n');
    const b = body(
      '<div class="markdown-alert markdown-alert-note"><p class="markdown-alert-title"><svg></svg>Note</p><p>꼭 읽어 주세요.</p></div>' +
        '<p>본문<sup><a href="#fn-1">1</a></sup>.</p>' +
        '<table><tbody><tr><td>Host Namespaces</td><td><ul><li><code>spec.hostPID</code></li></ul></td></tr></tbody></table>' +
        '<section class="footnotes" data-footnotes><h2 id="footnote-label" class="sr-only">Footnotes</h2><ol><li id="fn-1"><p>고마운 분들 <a href="#fnref-1" class="data-footnote-backref">↩</a></p></li></ol></section>',
    );
    const blocks = domBlocks(b);
    expect(blocks.some((d) => d.kind === 'heading')).toBe(false);
    const map = mapBlocks(blocks, sourceBlocks(src), null);
    const lineOf = (sel: string) => map.get(b.querySelector<HTMLElement>(sel)!)?.start;
    expect(lineOf('.markdown-alert-title')).toBe(1);
    expect(lineOf('.markdown-alert p:not(.markdown-alert-title)')).toBe(2);
    expect(lineOf('table tr')).toBe(7);
    expect(lineOf('table li')).toBe(7);
    expect(lineOf('#fn-1')).toBe(10);
    expect(map.size).toBe(blocks.length);
  });
});

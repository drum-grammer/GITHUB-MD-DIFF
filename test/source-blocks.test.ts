import { describe, expect, it } from 'vitest';
import { frontMatterLines, normalizeText, sourceBlocks } from '../src/source-blocks';

const pick = (src: string) => sourceBlocks(src).map((b) => [b.kind, b.start, b.end, normalizeText(b.text)]);

describe('sourceBlocks', () => {
  it('제목·여러 줄 문단·코드 블록의 줄 범위(1부터, 끝 포함)', () => {
    const src = ['# 제목', '', '첫 줄', '둘째 줄', '', '```ts', 'const a = 1;', '```'].join('\n');
    expect(pick(src)).toEqual([
      ['heading', 1, 1, '제목'],
      ['paragraph', 3, 4, '첫줄둘째줄'],
      ['code', 6, 8, 'consta1'],
    ]);
  });

  it('목록 항목은 자기 글만 — 안쪽 목록은 따로, 이어지는 줄은 항목에 붙는다', () => {
    const src = ['- 하나', '  이어짐', '  - 안쪽', '- 둘'].join('\n');
    expect(pick(src)).toEqual([
      ['item', 1, 2, '하나이어짐'],
      ['item', 3, 3, '안쪽'],
      ['item', 4, 4, '둘'],
    ]);
  });

  it('표는 행 하나가 블록이고 칸 글을 이어 붙인다', () => {
    const src = ['| 이름 | 상태 |', '|---|---|', '| 가 | 대기 |', '| 나 | 완료 |'].join('\n');
    expect(pick(src)).toEqual([
      ['row', 1, 1, '이름상태'],
      ['row', 3, 3, '가대기'],
      ['row', 4, 4, '나완료'],
    ]);
  });

  it('인용문 안 문단은 문단, 링크 주소·강조 기호는 글에서 빠진다', () => {
    const src = ['> **굵게** [링크](https://example.com) `코드`'].join('\n');
    expect(pick(src)).toEqual([['paragraph', 1, 1, '굵게링크코드']]);
  });

  it('머리말은 키마다 표 행 — 들여 쓴 값 줄은 앞 키에 붙고, 본문 줄 번호는 그대로다', () => {
    const src = ['---', 'title: 제목', 'versions:', '  fpt: "*"', '---', '', '본문'].join('\n');
    expect(frontMatterLines(src.split('\n'))).toBe(5);
    expect(pick(src)).toEqual([
      ['row', 2, 2, 'title제목'],
      ['row', 3, 4, 'versionsfpt'],
      ['paragraph', 7, 7, '본문'],
    ]);
  });

  it('CRLF 줄바꿈도 같은 줄 번호', () => {
    expect(pick('# a\r\n\r\nb')).toEqual([
      ['heading', 1, 1, 'a'],
      ['paragraph', 3, 3, 'b'],
    ]);
  });
});

describe('sourceBlocks — HTML 블록·알림·각주', () => {
  it('HTML 표는 행이 블록, 칸 안 목록 항목도 블록 — 표 안 문단은 세지 않는다', () => {
    const src = [
      '# 정책', // 1
      '', // 2
      '<table>', // 3
      '  <tr>', // 4
      '    <td>Host Namespaces</td>', // 5
      '    <td>', // 6
      '      <p>Sharing must be <strong>disallowed</strong>.</p>', // 7
      '      <ul>', // 8
      '        <li><code>spec.hostNetwork</code></li>', // 9
      '        <li>Undefined/nil &amp; false</li>', // 10
      '      </ul>', // 11
      '    </td>', // 12
      '  </tr>', // 13
      '</table>', // 14
    ].join('\n');
    const b = sourceBlocks(src);
    expect(b.map((x) => [x.kind, x.start, x.end])).toEqual([
      ['heading', 1, 1],
      ['row', 4, 13],
      ['item', 9, 9],
      ['item', 10, 10],
    ]);
    expect(normalizeText(b[1].text)).toBe(normalizeText('Host Namespaces Sharing must be disallowed. spec.hostNetwork Undefined/nil false'));
    expect(b[3].text).not.toContain('&amp;');
  });

  it('<p align="center"> 같은 HTML 문단과 닫는 태그를 생략한 항목', () => {
    const src = ['<p align="center">', '  <a href="x">Node.js</a> Website', '</p>', '', '<ul>', '<li>하나', '<li>둘', '</ul>'].join('\n');
    expect(sourceBlocks(src).map((x) => [x.kind, x.start, x.end, normalizeText(x.text)])).toEqual([
      ['paragraph', 1, 3, 'nodejswebsite'],
      ['item', 6, 7, '하나'],
      ['item', 7, 8, '둘'],
    ]);
  });

  it('GitHub 알림 — 표시 줄은 "Note" 제목 문단, 나머지는 본문 문단', () => {
    const src = ['문단', '', '> [!NOTE]', '> 꼭 읽어 주세요.', '> 두 번째 줄', '', '> 그냥 인용 [!TIP]', '', '1. 항목', '   > [!NOTE]', '   > 목록 안은 알림이 아니다'].join('\n');
    expect(sourceBlocks(src).map((x) => [x.kind, x.start, x.end, x.text])).toEqual([
      ['paragraph', 1, 1, '문단'],
      ['paragraph', 3, 3, 'Note'],
      ['paragraph', 4, 5, '꼭 읽어 주세요. 두 번째 줄'],
      ['paragraph', 7, 7, '그냥 인용 [!TIP]'],
      ['item', 9, 9, '항목'],
      ['paragraph', 10, 11, '[!NOTE] 목록 안은 알림이 아니다'],
    ]);
  });

  it('각주 정의는 항목 블록 — 붙어 있는 정의도 하나씩, 이어지는 줄은 앞 정의에', () => {
    const src = ['본문[^1]과 다른 것[^note].', '', '[^1]: 첫 각주', '[^note]: 둘째 각주', '  이어지는 줄', '', '```', '[^2]: 코드 안', '```'].join('\n');
    expect(sourceBlocks(src).map((x) => [x.kind, x.start, x.end, x.text])).toEqual([
      ['paragraph', 1, 1, '본문[^1]과 다른 것[^note].'],
      ['item', 3, 3, '첫 각주'],
      ['item', 4, 5, '둘째 각주 이어지는 줄'],
      ['code', 7, 9, '[^2]: 코드 안\n'],
    ]);
  });

  it('각주의 렌더링 차례는 본문에서 처음 가리킨 순서, 다음이 각주 글 안의 참조 — 가리키지 않은 정의는 -1', () => {
    const src = ['[^b]: 둘째로 가리킨 것 [^c]', '', '앞[^A] 뒤[^b].', '', '[^a]: 먼저 가리킨 것', '[^c]: 각주 글에서만', '[^z]: 아무도 안 가리킴'].join('\n');
    expect(sourceBlocks(src).filter((x) => x.footnote !== undefined).map((x) => [x.start, x.footnote])).toEqual([
      [1, 1],
      [5, 0],
      [6, 2],
      [7, -1],
    ]);
  });
});

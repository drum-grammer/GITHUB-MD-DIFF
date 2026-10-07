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

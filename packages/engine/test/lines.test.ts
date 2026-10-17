import { describe, expect, it } from 'vitest';
import { eolCanon, eolStyle, hunks, lineOps, showInvisible } from '../src/lines';

describe('lines', () => {
  it('lineOps — 줄 단위 diff', () => {
    expect(lineOps(['a', 'b', 'c'], ['a', 'x', 'c'])).toEqual([
      { op: 'same', line: 'a' },
      { op: 'del', line: 'b' },
      { op: 'ins', line: 'x' },
      { op: 'same', line: 'c' },
    ]);
  });

  it('hunks — 1부터 끝 포함, 한쪽만 있으면 그쪽 범위만', () => {
    expect(hunks(['a', 'b', 'c'], ['a', 'x', 'c', 'd'])).toEqual([
      { old: { start: 2, end: 2 }, new: { start: 2, end: 2 }, oldLines: ['b'], newLines: ['x'] },
      { new: { start: 4, end: 4 }, oldLines: [], newLines: ['d'] },
    ]);
  });

  it('eolCanon·eolStyle — CRLF와 줄 끝 공백', () => {
    expect(eolCanon('a  \r\nb\t\r\n')).toBe(eolCanon('a\nb\n'));
    expect(eolStyle('a\r\nb\r\n')).toBe(2);
  });

  it('showInvisible — 보이지 않는 글자를 ⟦U+XXXX⟧로', () => {
    expect(showInvisible('a\u200Bb\u202E')).toBe('a⟦U+200B⟧b⟦U+202E⟧');
  });
});

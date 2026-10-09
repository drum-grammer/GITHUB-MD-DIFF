import { describe, expect, it } from 'vitest';
import { formatEdit, type Format } from '../src/md-format';

/** 글 안의 [ ]가 선택 — 서식을 씌운 뒤 글과 새 선택을 같은 꼴로 돌려준다 */
function run(marked: string, kind: Format): string {
  const start = marked.indexOf('[');
  const end = marked.indexOf(']') - 1;
  const value = marked.replace('[', '').replace(']', '');
  const e = formatEdit(value, start, end, kind);
  const out = value.slice(0, e.from) + e.insert + value.slice(e.to);
  return `${out.slice(0, e.selStart)}[${out.slice(e.selStart, e.selEnd)}]${out.slice(e.selEnd)}`;
}

describe('formatEdit', () => {
  it('굵게·기울임·코드 — 감싸고 안쪽 글을 고른다, 빈 선택이면 커서를 가운데에', () => {
    expect(run('a [글] b', 'bold')).toBe('a **[글]** b');
    expect(run('a [] b', 'italic')).toBe('a _[]_ b');
    expect(run('[x]', 'code')).toBe('`[x]`');
  });

  it('이미 감싸져 있으면 벗긴다(안쪽 선택이든 바깥 포함 선택이든)', () => {
    expect(run('a **[글]** b', 'bold')).toBe('a [글] b');
    expect(run('a [**글**] b', 'bold')).toBe('a [글] b');
  });

  it('여러 줄 코드는 펜스로', () => {
    expect(run('[a\nb]', 'code')).toBe('```\n[a\nb]\n```');
  });

  it('링크 — 글이 있으면 url 자리를, 없으면 글 자리를 고른다', () => {
    expect(run('[문서]', 'link')).toBe('[문서]([url])');
    expect(run('a []', 'link')).toBe('a [[]](url)');
  });

  it('줄 앞머리 — 고른 줄마다, 한 줄이면 커서가 같은 글자 뒤에', () => {
    expect(run('하나\n[둘\n셋]', 'ul')).toBe('하나\n[- 둘\n- 셋]');
    expect(run('[a\nb\nc]', 'ol')).toBe('[1. a\n2. b\n3. c]');
    expect(run('ab[]c', 'heading')).toBe('### ab[]c');
    expect(run('[일]', 'task')).toBe('- [ ] [일]');
    expect(run('[인용]', 'quote')).toBe('> [인용]');
  });

  it('모든 줄에 이미 있으면 뗀다, 다음 줄 맨 앞에서 끝난 선택은 그 줄을 넣지 않는다', () => {
    expect(run('[- a\n- b]', 'ul')).toBe('[a\nb]');
    expect(run('[1. a\n2. b]', 'ol')).toBe('[a\nb]');
    expect(run('[a\n]b', 'quote')).toBe('> [a\n]b');
  });

  it('멘션 — @를 넣고 커서를 뒤에', () => {
    expect(run('hi []', 'mention')).toBe('hi @[]');
  });

  it('리뷰에서 나온 경계 — 첫 줄이 빈 줄, 줄 가운데서 끝난 여러 줄 코드, 끝 공백', () => {
    expect(run('[]\nabc', 'heading')).toBe('### []\nabc');
    expect(formatEdit('\nabc', 0, 0, 'ul')).toEqual({ from: 0, to: 0, insert: '- ', selStart: 2, selEnd: 2 });
    expect(run('ab[c\nde]f', 'code')).toBe('ab\n```\n[c\nde]\n```\nf');
    expect(run('[word ]x', 'bold')).toBe('**[word]** x');
    expect(run('a[ 글 ]b', 'italic')).toBe('a _[글]_ b');
    expect(run('[  ]', 'bold')).toBe('**[  ]**');
  });

  it('줄 앞머리 섞임 — 번호는 다시 매기고, 할 일 줄은 글머리 목록이 아니고, 다른 제목 수준은 바꾼다', () => {
    expect(run('[1. a\nb]', 'ol')).toBe('[1. a\n2. b]');
    expect(run('[3. a\nb]', 'ol')).toBe('[1. a\n2. b]');
    // 할 일 줄은 [ ]가 선택 표시와 겹쳐서 formatEdit를 바로 본다
    expect(formatEdit('- [ ] x', 0, 7, 'ul').insert).toBe('- - [ ] x');
    expect(formatEdit('- [ ] x', 0, 7, 'task').insert).toBe('x');
    expect(run('## 제[]목', 'heading')).toBe('제[]목');
    expect(run('[## a\nb]', 'heading')).toBe('[### a\n### b]');
  });
});

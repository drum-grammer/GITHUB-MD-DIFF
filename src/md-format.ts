/** 서식 도구 막대 — 고른 글에 마크다운을 씌우거나 벗긴다. 화면은 모르고, 바꿀 범위·넣을 글·새 선택만 돌려준다 */

export type Format = 'heading' | 'bold' | 'italic' | 'quote' | 'code' | 'link' | 'ul' | 'ol' | 'task' | 'mention';

/** value[from, to)를 insert로 바꾸고, 바꾼 뒤 [selStart, selEnd)를 고른다 */
export interface Edit {
  from: number;
  to: number;
  insert: string;
  selStart: number;
  selEnd: number;
}

const LINE_PREFIX: Partial<Record<Format, string>> = { heading: '### ', quote: '> ', ul: '- ', task: '- [ ] ' };

export function formatEdit(value: string, start: number, end: number, kind: Format): Edit {
  const sel = value.slice(start, end);
  switch (kind) {
    case 'bold':
      return wrap(value, start, end, '**', '**');
    case 'italic':
      return wrap(value, start, end, '_', '_');
    case 'code':
      return sel.includes('\n') ? wrap(value, start, end, '```\n', '\n```') : wrap(value, start, end, '`', '`');
    case 'link': {
      // [글](url) — 글이 있으면 url 자리를, 없으면 글 자리를 고른다
      const insert = `[${sel}](url)`;
      const url = start + sel.length + 3;
      return sel ? { from: start, to: end, insert, selStart: url, selEnd: url + 3 } : { from: start, to: end, insert, selStart: start + 1, selEnd: start + 1 };
    }
    case 'mention': {
      const caret = start + 1 + sel.length;
      return { from: start, to: end, insert: `@${sel}`, selStart: caret, selEnd: caret };
    }
    default:
      return lines(value, start, end, kind);
  }
}

/** 앞뒤로 감싼다. 이미 감싸져 있으면(고른 글 안이든 바로 바깥이든) 벗긴다 */
function wrap(value: string, start: number, end: number, before: string, after: string): Edit {
  const sel = value.slice(start, end);
  if (sel.length >= before.length + after.length && sel.startsWith(before) && sel.endsWith(after)) {
    const inner = sel.slice(before.length, sel.length - after.length);
    return { from: start, to: end, insert: inner, selStart: start, selEnd: start + inner.length };
  }
  if (value.slice(start - before.length, start) === before && value.slice(end, end + after.length) === after) {
    return { from: start - before.length, to: end + after.length, insert: sel, selStart: start - before.length, selEnd: end - before.length };
  }
  return { from: start, to: end, insert: before + sel + after, selStart: start + before.length, selEnd: end + before.length };
}

/** 고른 줄마다 앞머리(### · > · - · 1. · - [ ])를 붙인다. 모든 줄에 이미 있으면 뗀다 */
function lines(value: string, start: number, end: number, kind: Format): Edit {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  // 다음 줄 맨 앞에서 끝난 선택은 그 줄을 넣지 않는다
  const stop = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nl = value.indexOf('\n', stop);
  const to = nl === -1 ? value.length : nl;
  const rows = value.slice(from, to).split('\n');
  const prefix = (i: number) => (kind === 'ol' ? `${i + 1}. ` : LINE_PREFIX[kind] ?? '');
  const has = (row: string, i: number) => (kind === 'ol' ? /^\d+\. /.test(row) : row.startsWith(prefix(i)));
  const out = rows.every(has)
    ? rows.map((row, i) => (kind === 'ol' ? row.replace(/^\d+\. /, '') : row.slice(prefix(i).length)))
    : rows.map((row, i) => prefix(i) + row);
  const insert = out.join('\n');
  if (rows.length === 1) {
    // 한 줄이면 커서를 같은 글자 뒤에 둔다
    const shift = insert.length - rows[0].length;
    const caret = (n: number) => Math.max(from, n + shift);
    return { from, to, insert, selStart: caret(start), selEnd: caret(end) };
  }
  return { from, to, insert, selStart: from, selEnd: from + insert.length };
}

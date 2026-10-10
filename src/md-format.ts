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

/** 줄 앞머리 — 이미 붙은 것(marker)과 새로 붙일 것(make). 할 일 줄(- [ ])은 글머리 목록으로 보지 않는다 */
const LINE: Partial<Record<Format, { marker: RegExp; make: (i: number) => string }>> = {
  heading: { marker: /^#{1,6} /, make: () => '### ' },
  quote: { marker: /^> /, make: () => '> ' },
  ul: { marker: /^- (?!\[[ xX]\] )/, make: () => '- ' },
  ol: { marker: /^\d+\. /, make: (i) => `${i + 1}. ` },
  task: { marker: /^- \[[ xX]\] /, make: () => '- [ ] ' },
};

/** 목록 앞머리(할 일·글머리·번호) — 목록 종류를 바꿀 때 있던 것을 떼고 새로 붙인다(GitHub 도구 막대와 같다) */
const ANY_LIST = /^(?:- \[[ xX]\] |- |\d+\. )/;
const LISTS: Format[] = ['ul', 'ol', 'task'];

export function formatEdit(value: string, start: number, end: number, kind: Format): Edit {
  const sel = value.slice(start, end);
  switch (kind) {
    case 'bold':
      return wrap(value, start, end, '**', '**');
    case 'italic':
      return wrap(value, start, end, '_', '_');
    case 'code': {
      if (!sel.includes('\n')) return wrap(value, start, end, '`', '`');
      // 펜스는 줄 맨 앞에 있어야 렌더링된다 — 줄 가운데서 시작·끝난 선택이면 줄을 바꿔 준다
      const lead = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
      const tail = end < value.length && value[end] !== '\n' ? '\n' : '';
      return wrap(value, start, end, `${lead}\`\`\`\n`, `\n\`\`\`${tail}`);
    }
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

/** 앞뒤로 감싼다. 이미 감싸져 있으면(고른 글 안이든 바로 바깥이든) 벗긴다. 선택 끝의 공백은 표시 밖에 둔다(\*\*글 \*\*은 굵게가 안 된다) */
function wrap(value: string, start: number, end: number, before: string, after: string): Edit {
  const raw = value.slice(start, end);
  if (raw.trim()) {
    start += raw.length - raw.trimStart().length;
    end -= raw.length - raw.trimEnd().length;
  }
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
  const from = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  // 다음 줄 맨 앞에서 끝난 선택은 그 줄을 넣지 않는다
  const stop = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nl = value.indexOf('\n', stop);
  const to = nl === -1 ? value.length : nl;
  const rows = value.slice(from, to).split('\n');
  const { marker, make } = LINE[kind]!;
  const strip = LISTS.includes(kind) ? ANY_LIST : marker;
  // 모든 줄에 이미 있으면 떼고, 아니면 (있던 것은 — 목록이면 다른 종류도 — 떼고) 새로 붙인다 — 번호는 1부터 다시 매긴다
  const out = rows.every((row) => marker.test(row)) ? rows.map((row) => row.replace(marker, '')) : rows.map((row, i) => make(i) + row.replace(strip, ''));
  const insert = out.join('\n');
  if (rows.length === 1) {
    // 한 줄이면 커서를 같은 글자 뒤에 둔다
    const shift = insert.length - rows[0].length;
    const caret = (n: number) => Math.max(from, n + shift);
    return { from, to, insert, selStart: caret(start), selEnd: caret(end) };
  }
  return { from, to, insert, selStart: from, selEnd: from + insert.length };
}

/**
 * 제안(suggestion) — 원래 줄을 ```suggestion 블록에 넣어 고른 글 자리에 둔다. 펜스는 줄 맨 앞에 있어야 하므로 필요하면 줄을 바꾸고,
 * 원래 줄에 백틱 펜스가 있으면 그보다 긴 펜스로 감싼다. 커서는 원래 줄 끝 — 거기서 고쳐 쓴다
 */
export function suggestionEdit(value: string, start: number, end: number, original: string): Edit {
  const longest = Math.max(0, ...(original.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const lead = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const tail = end < value.length && value[end] !== '\n' ? '\n' : '';
  const head = `${lead}${fence}suggestion\n${original}`;
  const caret = start + head.length;
  return { from: start, to: end, insert: `${head}\n${fence}${tail}`, selStart: caret, selEnd: caret };
}

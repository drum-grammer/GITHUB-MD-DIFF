import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

/** 코멘트를 달 수 있는 블록 종류 — 렌더링 화면(DOM)과 원문 양쪽에서 같은 기준으로 나눈다 */
export type BlockKind = 'heading' | 'paragraph' | 'item' | 'row' | 'code';

export interface SourceBlock {
  kind: BlockKind;
  /** 1부터, 끝 포함 */
  start: number;
  end: number;
  text: string;
}

const md = new MarkdownIt('default', { html: true });

/** 글자 비교용 — 기호·공백·대소문자를 지우고 글자와 숫자만 남긴다 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 맨 앞 YAML 머리말(`---` … `---`)의 줄 수. 마크다운으로 읽지 않고 키마다 표 행으로 본다 */
export function frontMatterLines(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === '---' || l === '...') return i + 1;
  }
  return 0;
}

/** 할 일 목록 표시 — GitHub는 체크 상자로 그리므로 글에서 뺀다 */
const TASK_MARK = /^\[[ xX]\]\s+/;
const YAML_KEY = /^([^\s#:][^:]*):(?:\s+(.*))?$/;

/**
 * 머리말의 맨 위 키 하나가 표 한 행이다(GitHub가 머리말을 키·값 표로 그린다). 들여 쓴 줄·`-` 줄은 앞 키의 값이다.
 * 글은 키와 값을 이어 붙인 것 — 따옴표·기호는 비교할 때 지워진다.
 */
function frontMatterRows(lines: string[], count: number): SourceBlock[] {
  const out: SourceBlock[] = [];
  for (let i = 1; i < count - 1; i++) {
    const m = lines[i].match(YAML_KEY);
    if (m && !/^\s/.test(lines[i])) {
      out.push({ kind: 'row', start: i + 1, end: i + 1, text: `${m[1]} ${m[2] ?? ''}` });
    } else if (out.length && lines[i].trim()) {
      const last = out[out.length - 1];
      last.end = i + 1;
      last.text += ` ${lines[i].trim()}`;
    }
  }
  return out;
}

/** 인라인 토큰의 보이는 글자 — 링크 주소·HTML 태그·이미지는 빼고 글과 코드만 */
function inlineText(token: Token | undefined): string {
  if (!token || token.type !== 'inline') return '';
  let out = '';
  for (const c of token.children ?? []) {
    if (c.type === 'text' || c.type === 'code_inline') out += c.content;
    else if (c.type === 'softbreak' || c.type === 'hardbreak') out += ' ';
  }
  return out;
}

interface OpenItem {
  block: SourceBlock;
  texts: string[];
}

/** 인용문 — 첫 문단이 GitHub 알림 표시(`[!NOTE]` 등)인지 보려고 문단을 셌다 */
interface OpenQuote {
  quote: true;
  paragraphs: number;
}

/** GitHub 알림(`> [!NOTE]`) — 표시 줄은 렌더링에서 "Note" 같은 제목 문단이 된다 */
const ALERT = /^\s*(?:>\s*)+\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
/** 각주 정의 줄 — GitHub는 문서 끝 각주 목록의 항목으로 그린다 */
const FOOTNOTE = /^\[\^[^\]\s]+\]:\s?(.*)$/;

/** HTML 블록 안의 블록 태그 — 렌더링 쪽(dom-blocks)과 같은 종류로 센다 */
const HTML_TAG = /<(\/?)(tr|li|p|h[1-6]|pre|table|ul|ol)\b[^>]*?(\/?)>/gi;
/** 같은 태그가 다시 열리면 앞의 것이 닫힌 것으로 본다(HTML이 닫는 태그 생략을 허용하는 것) */
const IMPLIED_CLOSE = new Set(['li', 'p', 'tr']);
/** 블록이 아니라 묶음 — 항목의 짝을 맞추는 데만 쓴다 */
const LIST_TAG = new Set(['ul', 'ol']);

/** 태그와 문자 참조를 지운 글 */
function htmlText(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[#\w]+;/g, ' ');
}

/**
 * HTML 블록(`<table>`·`<p align="center">` 등)을 블록으로 나눈다. 표 행·목록 항목·문단·제목·코드가 블록이고,
 * 표 안의 문단은 세지 않는다(렌더링 쪽도 표 안 문단은 행이 맡는다). 닫는 태그를 생략한 것은 바깥 태그가 닫힐 때 닫는다.
 */
export function htmlBlocks(content: string, firstLine: number): SourceBlock[] {
  const out: Array<SourceBlock & { order: number }> = [];
  const open: Array<{ tag: string; line: number; from: number; inTable: boolean }> = [];
  let tables = 0;
  let line = firstLine;
  let scanned = 0;
  const lineAt = (index: number): number => {
    for (; scanned < index; scanned++) if (content.charCodeAt(scanned) === 10) line++;
    return line;
  };
  const close = (o: (typeof open)[number], index: number, endLine: number): void => {
    if (LIST_TAG.has(o.tag) || (o.tag === 'p' && o.inTable)) return;
    const kind: BlockKind = /^h\d$/.test(o.tag) ? 'heading' : o.tag === 'tr' ? 'row' : o.tag === 'li' ? 'item' : o.tag === 'pre' ? 'code' : 'paragraph';
    out.push({ kind, start: o.line, end: Math.max(o.line, endLine), text: htmlText(content.slice(o.from, index)), order: o.from });
  };
  for (const m of content.matchAll(HTML_TAG)) {
    const at = m.index ?? 0;
    const tag = m[2].toLowerCase();
    const here = lineAt(at);
    if (tag === 'table') {
      tables = Math.max(0, tables + (m[1] ? -1 : 1));
      continue;
    }
    if (!m[1]) {
      if (m[3]) continue;
      const top = open[open.length - 1];
      if (top && top.tag === tag && IMPLIED_CLOSE.has(tag)) close(open.pop()!, at, here);
      open.push({ tag, line: here, from: at + m[0].length, inTable: tables > 0 });
      continue;
    }
    const k = open.map((o) => o.tag).lastIndexOf(tag);
    if (k < 0) continue;
    for (const o of open.splice(k).reverse()) close(o, at, here);
  }
  const last = lineAt(content.replace(/\n+$/, '').length);
  for (const o of open.reverse()) close(o, content.length, last);
  return out.sort((a, b) => a.start - b.start || a.order - b.order).map(({ order: _, ...b }) => b);
}

/** 각주 정의를 항목 블록으로 — 정의 줄부터 빈 줄·다음 정의 앞까지. 코드 블록 안의 줄은 뺀다 */
function footnoteItems(lines: string[], inCode: (line: number) => boolean): SourceBlock[] {
  const out: SourceBlock[] = [];
  let cur: SourceBlock | null = null;
  lines.forEach((raw, i) => {
    const n = i + 1;
    const m = inCode(n) ? null : raw.match(FOOTNOTE);
    if (m) {
      cur = { kind: 'item', start: n, end: n, text: m[1] };
      out.push(cur);
    } else if (cur && raw.trim() && !inCode(n)) {
      cur.end = n;
      cur.text += ` ${raw.trim()}`;
    } else {
      cur = null;
    }
  });
  return out;
}

/**
 * 원문을 블록으로 나눈다. 목록 항목은 자기 문단만(안쪽 목록·코드·표는 따로), 표는 행 하나가 블록이다.
 * 인용문 안 문단은 문단 블록이다. map은 0부터·끝 미포함이라 1부터·끝 포함으로 바꾼다.
 */
export function sourceBlocks(src: string): SourceBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const skip = frontMatterLines(lines);
  const body = lines.map((l, i) => (i < skip ? '' : l)).join('\n');
  const tokens = md.parse(body, {});
  const out: SourceBlock[] = frontMatterRows(lines, skip);
  const code: Array<[number, number]> = tokens.filter((t) => (t.type === 'fence' || t.type === 'code_block') && t.map).map((t) => [t.map![0] + 1, t.map![1]]);
  const inCode = (n: number): boolean => code.some(([a, b]) => n >= a && n <= b);
  const footnotes = footnoteItems(lines, inCode);
  const footnoteLines = new Set(footnotes.flatMap((f) => Array.from({ length: f.end - f.start + 1 }, (_, k) => f.start + k)));
  // 열린 컨테이너 — 문단이 목록 항목 바로 안인지, 인용문의 첫 문단인지 알기 위해
  const containers: Array<OpenItem | OpenQuote> = [];
  const push = (kind: BlockKind, map: [number, number] | null, text: string): SourceBlock | null => {
    if (!map) return null;
    const block = { kind, start: map[0] + 1, end: Math.max(map[0] + 1, map[1]), text };
    out.push(block);
    return block;
  };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    switch (tk.type) {
      case 'heading_open':
        push('heading', tk.map, inlineText(tokens[i + 1]));
        break;
      case 'list_item_open': {
        const block = push('item', tk.map, '');
        if (block) block.end = block.start;
        containers.push(block ? { block, texts: [] } : { quote: true, paragraphs: 1 });
        break;
      }
      case 'list_item_close': {
        const open = containers.pop();
        if (open && 'block' in open) open.block.text = open.texts.join(' ');
        break;
      }
      case 'blockquote_open':
        containers.push({ quote: true, paragraphs: 0 });
        break;
      case 'blockquote_close':
        containers.pop();
        break;
      case 'paragraph_open': {
        const top = containers[containers.length - 1];
        const text = inlineText(tokens[i + 1]);
        if (top && 'block' in top) {
          top.texts.push(top.texts.length === 0 ? text.replace(TASK_MARK, '') : text);
          if (tk.map) top.block.end = Math.max(top.block.end, tk.map[1]);
        } else if (tk.map && footnoteLines.has(tk.map[0] + 1)) {
          // 각주 정의 — 아래에서 항목으로 넣는다
        } else if (top && top.paragraphs++ === 0 && tk.map && ALERT.test(lines[tk.map[0]] ?? '')) {
          // 알림 표시 줄은 제목 문단("Note"), 나머지가 본문 문단
          const [first, end] = tk.map;
          const kind = (lines[first].match(ALERT)?.[1] ?? '').toLowerCase();
          push('paragraph', [first, first + 1], kind.charAt(0).toUpperCase() + kind.slice(1));
          if (end > first + 1) push('paragraph', [first + 1, end], text.replace(/^\s*\[![a-z]+\]\s*/i, ''));
        } else {
          push('paragraph', tk.map, text);
        }
        break;
      }
      case 'html_block':
        if (tk.map) out.push(...htmlBlocks(tk.content, tk.map[0] + 1));
        break;
      case 'tr_open': {
        const cells: string[] = [];
        for (let j = i + 1; j < tokens.length && tokens[j].type !== 'tr_close'; j++) {
          if (tokens[j].type === 'inline') cells.push(inlineText(tokens[j]));
        }
        push('row', tk.map, cells.join(' '));
        break;
      }
      case 'fence':
      case 'code_block':
        push('code', tk.map, tk.content);
        break;
    }
  }
  if (footnotes.length === 0) return out;
  return [...out, ...footnotes].sort((a, b) => a.start - b.start); // 같은 줄이면 원래 순서(안정 정렬)
}

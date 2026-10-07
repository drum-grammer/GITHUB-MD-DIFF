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
  // 열린 컨테이너 — 문단이 목록 항목 바로 안인지 알기 위해
  const containers: Array<OpenItem | 'quote'> = [];
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
        containers.push(block ? { block, texts: [] } : 'quote');
        break;
      }
      case 'list_item_close': {
        const open = containers.pop();
        if (open && open !== 'quote') open.block.text = open.texts.join(' ');
        break;
      }
      case 'blockquote_open':
        containers.push('quote');
        break;
      case 'blockquote_close':
        containers.pop();
        break;
      case 'paragraph_open': {
        const top = containers[containers.length - 1];
        const text = inlineText(tokens[i + 1]);
        if (top && top !== 'quote') {
          top.texts.push(top.texts.length === 0 ? text.replace(TASK_MARK, '') : text);
          if (tk.map) top.block.end = Math.max(top.block.end, tk.map[1]);
        } else {
          push('paragraph', tk.map, text);
        }
        break;
      }
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
  return out;
}

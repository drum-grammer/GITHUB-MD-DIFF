import { alignBlocks } from './align';
import type { Side } from './github-api';
import { COMMENT_BLOCK, INLINE_DELETED, INLINE_INSERTED, MDF_ATTR, REMOVED_BLOCK } from './selectors';
import type { BlockKind, SourceBlock } from './source-blocks';

export interface DomBlock {
  el: HTMLElement;
  kind: BlockKind;
  side: Side;
  text: string;
}

/** 블록이 가리키는 원문 줄(1부터, 끝 포함) */
export interface BlockTarget {
  side: Side;
  start: number;
  end: number;
}

/** 목록 항목의 자기 글에서 빼는 것 — 안쪽 목록·코드·표·인용문은 따로 블록이다 */
const ITEM_NESTED = new Set(['UL', 'OL', 'PRE', 'TABLE', 'BLOCKQUOTE']);

function kindOf(el: HTMLElement): BlockKind | null {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return 'heading';
  if (tag === 'LI') return 'item';
  if (tag === 'PRE') return 'code';
  if (tag === 'TR') {
    // 머리말 표 안의 표(목록 값)는 원문 표 행이 아니다
    return el.closest('table')?.parentElement?.closest('table') ? null : 'row';
  }
  if (tag === 'P') {
    if (el.closest('table')) return null;
    // 목록 항목 바로 안의 문단은 항목 블록이 맡는다(인용문 안이면 문단)
    return el.parentElement?.closest('li, blockquote')?.tagName === 'LI' ? null : 'paragraph';
  }
  return null;
}

/** 보이는 글자 — 확장이 만든 것과 반대쪽 글자 변경은 빼고, 목록 항목은 자기 글만 */
function ownText(el: HTMLElement, side: Side): string {
  const skipInline = side === 'right' ? INLINE_DELETED : INLINE_INSERTED;
  const skip = (node: Element): boolean =>
    node.hasAttribute(MDF_ATTR) || node.matches(skipInline) || (el.tagName === 'LI' && node !== el && ITEM_NESTED.has(node.tagName));
  if (el.tagName === 'TR') {
    return [...(el as HTMLTableRowElement).cells].map((c) => textOf(c, skip)).join(' ');
  }
  return textOf(el, skip);
}

function textOf(root: Element, skip: (node: Element) => boolean): string {
  let out = '';
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? '';
      else if (child.nodeType === Node.ELEMENT_NODE && !skip(child as Element)) walk(child);
    }
  };
  walk(root);
  return out;
}

/** 렌더링 본문의 코멘트 블록을 문서 순서로. 블록째 지운 것은 원래 파일(left), 나머지는 새 파일(right) 쪽이다 */
export function domBlocks(body: HTMLElement): DomBlock[] {
  const out: DomBlock[] = [];
  for (const el of body.querySelectorAll<HTMLElement>(COMMENT_BLOCK)) {
    if (el.closest(`[${MDF_ATTR}]`)) continue; // 확장이 만든 것(합친 표 등)
    if (el.closest('.sr-only')) continue; // 화면에 안 보이는 글(각주 목록의 "Footnotes" 제목 등)
    const kind = kindOf(el);
    if (!kind) continue;
    const removed = el.closest(REMOVED_BLOCK);
    const side: Side = removed && body.contains(removed) ? 'left' : 'right';
    out.push({ el, kind, side, text: ownText(el, side) });
  }
  return out;
}

/** 렌더링 블록마다 원문 줄을 찾는다. 원문이 없는 쪽(null)이나 맞는 짝이 없는 블록은 빠진다 */
export function mapBlocks(
  blocks: DomBlock[],
  head: SourceBlock[] | null,
  base: SourceBlock[] | null,
): Map<HTMLElement, BlockTarget> {
  const map = new Map<HTMLElement, BlockTarget>();
  for (const [side, src] of [
    ['right', head],
    ['left', base],
  ] as const) {
    if (!src) continue;
    const dom = blocks.filter((b) => b.side === side);
    alignBlocks(dom, src).forEach((j, i) => {
      if (j >= 0) map.set(dom[i].el, { side, start: src[j].start, end: src[j].end });
    });
  }
  return map;
}

/** 블록들의 줄 범위를 하나로 합친다(같은 쪽만) */
export function spanOf(targets: BlockTarget[]): BlockTarget | null {
  if (targets.length === 0) return null;
  const side = targets[0].side;
  if (targets.some((t) => t.side !== side)) return null;
  return { side, start: Math.min(...targets.map((t) => t.start)), end: Math.max(...targets.map((t) => t.end)) };
}

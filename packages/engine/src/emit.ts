/**
 * GitHub rich diff와 같은 표기의 HTML(스펙 §4-3) — `.prose-diff .markdown-body` 안쪽.
 * 최상위 블록마다 rich-diff-level-zero, 바뀐 곳 앞뒤 vicinity, 이어진 변경 없는 블록은 div.expandable.unchanged.js-expandable,
 * 바뀐 블록은 div.changed > …rich-diff-level-one + ins/del, 통째 추가·삭제는 최상위 <ins>/<del>. 잎마다 data-mdc-new/old
 */
import type { Bar, Plan, PlanItem } from './diff';
import { leafOf } from './diff';
import { ELEMENT_NODE, TEXT_NODE, engineDocument } from './dom';
import { ITEM_NESTED } from './keys';
import { lineOps, showInvisible } from './lines';
import { isRemote, repoImagePath } from './safe-url';
import { LEAF_ATTR, type Side, type TopUnit } from './side';
import type { FileDiff, Kind, Range, RenderContext } from './types';

/** "원문만 바뀜" 막대 문구 */
export const SOURCE_ONLY_LABEL = 'Source changed — not visible in the rendering';
export const DELETED_LABEL = 'This file was deleted.';

type Unit = { kind: 'same' | 'change'; nodes: Node[] };

const fmt = (r: Range): string => `${r.start}-${r.end}`;
/** 통째로 옛·새를 내는 최상위 토큰 — 단어 표시를 하지 않는다 */
const WHOLE_TYPES = new Set(['fence', 'code_block', 'table_open', 'front_matter', 'html_block', 'math_block', 'hr']);
const CONTAINER_TYPES = new Set(['bullet_list_open', 'ordered_list_open', 'blockquote_open']);

function setLines(el: Element, newRange?: Range, oldRange?: Range): void {
  if (newRange) el.setAttribute('data-mdc-new', fmt(newRange));
  if (oldRange) el.setAttribute('data-mdc-old', fmt(oldRange));
}

/** 최상위 조각 사본 — 맨 위 공백 글 노드는 뺀다 */
function cloneTop(top: TopUnit): HTMLDivElement {
  const c = top.container.cloneNode(true) as HTMLDivElement;
  for (const n of [...c.childNodes]) if (n.nodeType === TEXT_NODE && !(n.textContent ?? '').trim()) n.remove();
  return c;
}

class Emitter {
  private readonly doc = engineDocument();
  readonly units: Unit[] = [];

  constructor(
    private readonly plan: Plan,
    private readonly ns: Side,
  ) {}

  private get os(): Side | null {
    return this.plan.oldSide;
  }

  /** 새 쪽 사본의 잎에 줄 속성 — 짝이 있으면 옛 줄도 */
  private markNew(root: Element): void {
    for (const el of root.querySelectorAll(`[${LEAF_ATTR}]`)) {
      const i = Number(el.getAttribute(LEAF_ATTR));
      const j = this.plan.newToOld.get(i);
      setLines(el, leafOf(this.ns, i).range, j !== undefined && this.os ? leafOf(this.os, j).range : undefined);
    }
  }

  /** 옛 쪽 사본의 잎에 줄 속성. 옛 사본은 새 사본 안에 섞여 들어가므로 잎 번호 표시는 지운다 */
  private markOld(root: Element): void {
    const els = root.matches(`[${LEAF_ATTR}]`) ? [root, ...root.querySelectorAll(`[${LEAF_ATTR}]`)] : [...root.querySelectorAll(`[${LEAF_ATTR}]`)];
    for (const el of els) {
      const j = Number(el.getAttribute(LEAF_ATTR));
      const i = this.plan.oldToNew.get(j);
      setLines(el, i !== undefined ? leafOf(this.ns, i).range : undefined, leafOf(this.os!, j).range);
      el.removeAttribute(LEAF_ATTR);
    }
  }

  private wrap(tag: 'ins' | 'del', nodes: Node[]): HTMLElement {
    const w = this.doc.createElement(tag);
    for (const n of nodes) if (n.nodeType === ELEMENT_NODE) (n as Element).classList.add('rich-diff-level-zero');
    w.append(...nodes);
    return w;
  }

  private changedDiv(nodes: Node[]): HTMLElement {
    const div = this.doc.createElement('div');
    div.className = 'changed rich-diff-level-zero';
    div.append(...nodes);
    return div;
  }

  private bar(b: Bar): HTMLElement {
    const div = this.doc.createElement('div');
    div.className = 'changed mdc-source-only rich-diff-level-zero';
    setLines(div, b.new, b.old);
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'mdc-source-only-toggle';
    button.setAttribute('aria-expanded', 'false');
    button.textContent = SOURCE_ONLY_LABEL;
    const pre = this.doc.createElement('pre');
    pre.className = 'mdc-source-diff';
    pre.hidden = true;
    setLines(pre, b.new, b.old); // 숨긴 원문도 코멘트 블록(COMMENT_BLOCK)이라 줄을 단다
    for (const { op, line } of lineOps(b.oldLines, b.newLines)) {
      const text = `${op === 'del' ? '-' : op === 'ins' ? '+' : ' '} ${showInvisible(line)}`;
      if (op === 'same') pre.append(`${text}\n`);
      else {
        const span = this.doc.createElement('span');
        span.className = op === 'del' ? 'mdc-del' : 'mdc-ins';
        span.textContent = text;
        pre.append(span, '\n');
      }
    }
    div.append(button, pre);
    return div;
  }

  private bars(list: Bar[]): void {
    for (const b of list) this.units.push({ kind: 'change', nodes: [this.bar(b)] });
  }

  /** 옛 잎 요소 사본(지운 표시용). 목록 항목은 자기 글만 — 안쪽 목록·코드·표·인용문은 따로 잎이라 사본에 넣으면 두 번 보인다 */
  private oldLeafClone(j: number): HTMLElement | null {
    const leaf = leafOf(this.os!, j);
    if (!leaf.el) return null;
    const c = leaf.el.cloneNode(true) as HTMLElement;
    if (leaf.kind === 'item' || leaf.kind === 'footnote') for (const n of [...c.children]) if (ITEM_NESTED.has(n.tagName)) n.remove();
    this.markOld(c);
    return c;
  }

  /** 고친 잎의 자기 글을 단어 비교 HTML로 바꾼다 — 목록 항목은 안쪽 블록을 그대로 두고 자기 글만 */
  private replaceOwn(el: HTMLElement, kind: Kind, html: string): void {
    if (kind !== 'item' && kind !== 'footnote') {
      el.innerHTML = html;
      return;
    }
    const own = [...el.childNodes].filter((n) => !(n.nodeType === ELEMENT_NODE && ITEM_NESTED.has((n as Element).tagName)));
    const loose = own.some((n) => n.nodeType === ELEMENT_NODE && (n as Element).tagName === 'P');
    const holder = this.doc.createElement(loose ? 'p' : 'span');
    holder.innerHTML = html;
    if (own[0]) own[0].before(holder);
    else el.prepend(holder);
    for (const n of own) n.remove();
    if (!loose) holder.replaceWith(...holder.childNodes);
  }

  /** 목록·인용문 안 — 잎마다 changed·added 클래스, 지운 잎은 그 자리에 .removed 사본 */
  private markInside(root: Element, item: Extract<PlanItem, { type: 'top' }>): void {
    for (const el of [...root.querySelectorAll<HTMLElement>(`[${LEAF_ATTR}]`)]) {
      const i = Number(el.getAttribute(LEAF_ATTR));
      const op = this.plan.newOps.get(i);
      if (!op || op.op === 'same' || op.op === 'removed') continue;
      if (op.op === 'added') {
        el.classList.add('added');
        continue;
      }
      const words = this.plan.words.get(i);
      if (words !== undefined) {
        el.classList.add('changed');
        this.replaceOwn(el, op.leaf.kind, words);
      } else {
        const old = this.oldLeafClone(this.plan.newToOld.get(i)!);
        if (old) {
          old.classList.add('removed');
          el.before(old);
        }
        el.classList.add('added');
      }
    }
    // 같은 기준 잎 뒤에 여럿이면 옛 차례대로 — 방금 넣은 것 뒤에 잇는다
    const lastAfter = new Map<number, Element>();
    for (const r of item.removedInside) {
      const old = this.oldLeafClone(r.old);
      if (!old) continue;
      old.classList.add('removed');
      const anchor = root.querySelector(`[${LEAF_ATTR}="${r.anchor}"]`);
      if (!anchor) {
        // 기준 잎이 이 묶음 밖이다(고친 알림의 제목 — 본문 묶음에 들지 않는다) — 본문 맨 앞에, 여럿이면 옛 차례대로
        const prev = lastAfter.get(r.anchor);
        if (prev) prev.after(old);
        else root.prepend(old);
        lastAfter.set(r.anchor, old);
      } else if (r.after) {
        (lastAfter.get(r.anchor) ?? anchor).after(old);
        lastAfter.set(r.anchor, old);
      } else anchor.before(old);
    }
  }

  top(item: Extract<PlanItem, { type: 'top' }>): void {
    const nt = this.ns.tops[item.newTop];
    const ot = item.oldTop === null ? null : this.os!.tops[item.oldTop];
    const { block } = item;
    const root = cloneTop(nt);
    this.markNew(root);
    const nodes = [...root.childNodes];
    if (block.op === 'same') {
      if (nodes.length) this.units.push({ kind: 'same', nodes });
      this.bars(item.bars);
      return;
    }
    if (block.op === 'added') {
      if (nodes.length) this.units.push({ kind: 'change', nodes: [this.wrap('ins', nodes)] });
      this.bars(item.bars);
      return;
    }
    const single = nt.leaves.length === 1 && item.removedInside.length === 0 ? nt.leaves[0] : null;
    const singleWords = single !== null ? this.plan.words.get(single) : undefined;
    if (ot && (block.wholeBlock || WHOLE_TYPES.has(nt.tokenType) || (single !== null && singleWords === undefined && !CONTAINER_TYPES.has(nt.tokenType) && nt.tokenType !== 'alert_open'))) {
      const old = cloneTop(ot);
      this.markOld(old);
      this.units.push({ kind: 'change', nodes: [this.wrap('del', [...old.childNodes]), this.wrap('ins', nodes)] });
    } else if (nt.tokenType === 'alert_open') {
      this.alert(root, item);
    } else if (CONTAINER_TYPES.has(nt.tokenType) || single === null) {
      this.markInside(root, item);
      const first = root.firstElementChild;
      first?.classList.add('rich-diff-level-one');
      this.units.push({ kind: 'change', nodes: [this.changedDiv([...root.childNodes])] });
    } else {
      // 문단·제목 — 바뀐 낱말만
      const el = root.querySelector<HTMLElement>(`[${LEAF_ATTR}]`)!;
      el.classList.add('rich-diff-level-one');
      el.innerHTML = singleWords!;
      this.units.push({ kind: 'change', nodes: [this.changedDiv([...root.childNodes])] });
    }
    this.bars(item.bars);
  }

  /** 고친 알림 — GitHub처럼 묶음 없이 제목 문단과 .changed 본문으로 */
  private alert(root: Element, item: Extract<PlanItem, { type: 'top' }>): void {
    const box = root.querySelector('.markdown-alert') ?? root.firstElementChild!;
    const title = box.querySelector<HTMLElement>(':scope > .markdown-alert-title');
    const rest = [...box.childNodes].filter((n) => n !== title && !(n.nodeType === TEXT_NODE && !(n.textContent ?? '').trim()));
    if (title) {
      const i = Number(title.getAttribute(LEAF_ATTR));
      const words = this.plan.words.get(i);
      const op = this.plan.newOps.get(i);
      if (op && op.op !== 'same') {
        title.classList.add('rich-diff-level-one');
        if (words !== undefined) title.innerHTML = words;
        this.units.push({ kind: 'change', nodes: [this.changedDiv([title])] });
      } else this.units.push({ kind: 'same', nodes: [title] });
    }
    const holder = this.doc.createElement('div');
    holder.append(...rest);
    const leaves = [...holder.querySelectorAll(`[${LEAF_ATTR}]`)].map((el) => this.plan.newOps.get(Number(el.getAttribute(LEAF_ATTR)))?.op);
    const removedHere = item.removedInside.filter((r) => holder.querySelector(`[${LEAF_ATTR}="${r.anchor}"]`) || r.anchor === Number(title?.getAttribute(LEAF_ATTR)));
    if (leaves.every((op) => op === 'same') && removedHere.length === 0) {
      for (const n of [...holder.childNodes]) this.units.push({ kind: 'same', nodes: [n] });
      return;
    }
    this.markInside(holder, { ...item, removedInside: removedHere });
    this.units.push({ kind: 'change', nodes: [this.changedDiv([...holder.childNodes])] });
  }

  removed(item: Extract<PlanItem, { type: 'removed' }>): void {
    const old = cloneTop(this.os!.tops[item.oldTop]);
    this.markOld(old);
    const nodes = [...old.childNodes];
    if (nodes.length) this.units.push({ kind: 'change', nodes: [this.wrap('del', nodes)] });
    this.bars(item.bars);
  }

  footnotes(item: Extract<PlanItem, { type: 'footnotes' }>): void {
    const section = this.doc.createElement('section');
    section.className = 'footnotes rich-diff-level-zero';
    section.setAttribute('data-footnotes', '');
    const h2 = this.doc.createElement('h2');
    h2.id = 'footnote-label';
    h2.className = 'sr-only';
    h2.textContent = 'Footnotes';
    const ol = this.doc.createElement('ol');
    for (const e of item.entries) {
      if (e.oldLeaf !== undefined && e.op !== 'same') {
        const old = this.oldLeafClone(e.oldLeaf);
        if (old) {
          old.classList.add('removed');
          ol.append(old);
        }
      }
      if (e.newLeaf !== undefined) {
        const el = leafOf(this.ns, e.newLeaf).el;
        if (!el) continue;
        const c = el.cloneNode(true) as HTMLElement;
        const holder = this.doc.createElement('div');
        holder.append(c);
        this.markNew(holder);
        if (e.op !== 'same') c.classList.add('added');
        ol.append(c);
      }
    }
    section.append(h2, ol);
    this.units.push({ kind: item.block.op === 'same' ? 'same' : 'change', nodes: [section] });
    this.bars(item.bars);
  }
}

/** 변경 없는 단위를 묶고 바뀐 곳 앞뒤에 vicinity를 단다 */
function assemble(body: HTMLElement, units: Unit[]): void {
  const doc = body.ownerDocument;
  const near = (k: number): boolean => units[k]?.kind === 'change';
  const mark = (nodes: Node[], classes: string[]): void => {
    for (const n of nodes) {
      if (n.nodeType !== ELEMENT_NODE) continue;
      const el = n as Element;
      if (el.tagName === 'A' && el.classList.contains('anchor')) continue;
      el.classList.add(...classes);
    }
  };
  for (let i = 0; i < units.length; ) {
    const u = units[i];
    if (u.kind === 'change') {
      body.append(...u.nodes);
      i++;
    } else if (near(i - 1) || near(i + 1)) {
      mark(u.nodes, ['vicinity', 'rich-diff-level-zero']);
      body.append(...u.nodes);
      i++;
    } else {
      const group = doc.createElement('div');
      group.className = 'expandable unchanged js-expandable rich-diff-level-zero';
      while (i < units.length && units[i].kind === 'same' && !near(i + 1)) {
        mark(units[i].nodes, ['unchanged', 'rich-diff-level-one']);
        group.append(...units[i].nodes);
        i++;
      }
      body.append(group);
    }
  }
}

/** src로 파일을 부르는 요소 — 이미지만이 아니라 동영상·소리도 바깥 주소를 부른다(같은 규칙) */
const MEDIA = 'img, video, audio, source, track';

/** 이미지 — 저장소 상대 경로는 서버가 발급한 id로, 바깥 주소는 기본으로 막는다 */
function images(body: HTMLElement, diff: FileDiff, ctx: RenderContext): void {
  for (const el of body.querySelectorAll(MEDIA)) {
    const src = el.getAttribute('src');
    if (src === null) continue;
    const side = el.closest('del, .removed') ? 'old' : 'new';
    if (isRemote(src)) {
      if (!ctx.allowRemoteImages) {
        el.removeAttribute('src');
        el.setAttribute('data-mdc-remote', src);
      }
      continue;
    }
    const repoPath = repoImagePath(side === 'old' ? (diff.oldPath ?? diff.path) : diff.path, src);
    const id = repoPath === null ? null : ctx.imageId(side, repoPath);
    if (id === null) {
      el.removeAttribute('src');
      el.setAttribute('data-mdc-blocked', '');
    } else el.setAttribute('src', `/file/${encodeURIComponent(id)}`);
  }
}

function finish(body: HTMLElement, rev: string | null): string {
  if (rev !== null) for (const child of body.children) child.setAttribute('data-mdc-rev', rev);
  for (const el of body.querySelectorAll(`[${LEAF_ATTR}]`)) el.removeAttribute(LEAF_ATTR);
  return body.innerHTML;
}

export function emit(diff: FileDiff, plan: Plan, ctx: RenderContext): string {
  const doc = engineDocument();
  const body = doc.createElement('div');
  if (!plan.newSide) {
    const div = doc.createElement('div');
    div.className = 'mdc-file-deleted';
    div.textContent = DELETED_LABEL;
    body.append(div);
    return finish(body, ctx.rev);
  }
  const e = new Emitter(plan, plan.newSide);
  for (const item of plan.items) {
    if (item.type === 'top') e.top(item);
    else if (item.type === 'removed') e.removed(item);
    else e.footnotes(item);
  }
  assemble(body, e.units);
  images(body, diff, ctx);
  return finish(body, ctx.rev);
}

/** 코멘트 미리보기 — diff 표시 없이 정화된 HTML. 이미지는 모두 막는다(발급할 서버 문맥이 없다) */
export function emitPlain(side: Side): string {
  const doc = engineDocument();
  const body = doc.createElement('div');
  for (const t of side.tops) body.append(...cloneTop(t).childNodes);
  const notes = side.footnotes.filter((f) => f.el);
  if (notes.length) {
    const section = doc.createElement('section');
    section.className = 'footnotes';
    section.setAttribute('data-footnotes', '');
    const ol = doc.createElement('ol');
    for (const f of notes) ol.append(f.el!.cloneNode(true));
    section.append(ol);
    body.append(section);
  }
  for (const el of body.querySelectorAll(MEDIA)) {
    el.removeAttribute('src');
    el.setAttribute('data-mdc-blocked', '');
  }
  return finish(body, null);
}

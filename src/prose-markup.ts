/**
 * 렌더링 diff 본문(`.prose-diff .markdown-body`) 안의 표기 — GitHub rich diff가 쓰고, 로컬 엔진도 똑같이 내는 이름들.
 * 파일 머리·버튼·화면 종류 같은 GitHub 페이지 껍데기는 selectors.ts에 남는다. selectors.ts는 여기 이름을 그대로 다시 내보낸다.
 *
 * 이 파일은 아무것도 import하지 않는다 — scripts/page-css.mjs가 Node(타입 지우기)로 selectors.ts를 바로 읽고,
 * selectors.ts가 이 파일을 읽기 때문이다.
 */
export const MDF_ATTR = 'data-mdf';
export const HIDDEN_CLASS = 'mdf-hidden';
/** 코멘트·스레드가 붙은 블록의 맨 위 묶음 — 접지 않는다 */
export const PIN_ATTR = 'data-mdf-pin';
/** 옛 화면은 .prose-diff.collapsed로 묶음 내용을 숨긴다. 확장이 접기를 맡는 동안 떼어 두고 이 속성으로 표시한다 */
export const UNCOLLAPSED_ATTR = 'data-mdf-uncollapsed';
/** 렌더링 본문 */
export const PROSE_BODY = '.prose-diff .markdown-body';

/** 코멘트를 붙이는 블록 — 제목·문단·목록 항목·표 행·코드 */
export const COMMENT_BLOCK = 'h1, h2, h3, h4, h5, h6, p, li, tr, pre';
/** 렌더링 diff에서 블록째 지운 내용 — 블록을 감싼 <del> 또는 .removed(2026-10-08 확인) */
export const REMOVED_BLOCK = 'del, .removed';
/** 고친 블록 안의 글자 단위 변경 — 새 파일 쪽 글에서는 <del>을, 원래 파일 쪽 글에서는 <ins>를 뺀다 */
export const INLINE_DELETED = 'del';
export const INLINE_INSERTED = 'ins';
/** 코멘트 상자를 감싼 바꾸기 표시를 벗어날 때 보는 것 — 상자가 취소선·밑줄을 물려받지 않게 */
export const CHANGE_WRAPPER = 'ins, del, .added, .removed';

const CHANGE_CLASSES = ['vicinity', 'changed', 'added', 'removed', 'moved'];
const CHANGE_INSIDE = 'ins, del, .vicinity, .changed, .added, .removed, .moved';

export interface TablePair {
  del: HTMLElement;
  ins: HTMLElement;
  oldTable: HTMLTableElement;
  newTable: HTMLTableElement;
}

/**
 * 렌더링 본문 바로 아래 블록 중 접어도 되는 것. GitHub는 변경 없는 블록을 묶음(`div.expandable.unchanged`)으로
 * 내기도 하고, 묶지 않고 블록마다 `unchanged`를 붙여 내기도 한다(2026-10-07 확인). 표·도표를 감싼 요소는 표시가 없고
 * 안쪽에만 `unchanged`가 있다. 앵커는 제목에 딸린 빈 요소다. 표시를 알 수 없으면 접지 않는다.
 */
export function isFoldable(el: Element): boolean {
  if (el.hasAttribute(MDF_ATTR) || el.hasAttribute(PIN_ATTR)) return false;
  if (el.tagName === 'INS' || el.tagName === 'DEL') return false;
  if (CHANGE_CLASSES.some((c) => el.classList.contains(c))) return false;
  if (el.classList.contains('unchanged') || isAnchor(el)) return true;
  return el.querySelector('.unchanged') !== null && el.querySelector(CHANGE_INSIDE) === null;
}

/** 블록 안에 표 하나만 있으면(감싼 요소 하나까지, 나머지는 공백) 그 표. 표를 품은 목록·인용문은 null — 합치면 표 아닌 글이 숨는다 */
function soleTable(block: Element): HTMLTableElement | null {
  if (block.children.length !== 1) return null;
  let el = block.firstElementChild!;
  if (el.tagName !== 'TABLE' && el.children.length === 1) el = el.firstElementChild!;
  if (el.tagName !== 'TABLE') return null;
  return (block.textContent ?? '').trim() === (el.textContent ?? '').trim() ? (el as HTMLTableElement) : null;
}

/** 최상위 <del>(표 하나) 바로 뒤 <ins>(표 하나) 쌍 — GitHub는 표가 조금만 바뀌어도 옛 표 전체·새 표 전체를 이렇게 낸다 */
export function tablePairs(body: Element): TablePair[] {
  const out: TablePair[] = [];
  for (const del of [...body.children] as HTMLElement[]) {
    if (del.tagName !== 'DEL') continue;
    const ins = del.nextElementSibling as HTMLElement | null;
    if (!ins || ins.tagName !== 'INS') continue;
    const oldTable = soleTable(del);
    const newTable = soleTable(ins);
    if (!oldTable || !newTable) continue;
    out.push({ del, ins, oldTable, newTable });
  }
  return out;
}

export function isAnchor(el: Element): boolean {
  return el.tagName === 'A' && el.classList.contains('anchor');
}

/** 블록으로 세지 않는 것: 제목 앵커, 옛 화면 묶음 맨 앞의 GitHub 펼치기 아이콘(svg) */
export function isDecoration(el: Element): boolean {
  return isAnchor(el) || el.tagName.toLowerCase() === 'svg';
}

/** 숨김을 켜고 끈다. 끌 때 class가 비면 속성째 지운다 — 원래 class가 없던 <del>/<ins>에 class=""가 남지 않게 */
export function setHidden(el: Element, hidden: boolean): void {
  el.classList.toggle(HIDDEN_CLASS, hidden);
  if (!hidden && el.classList.length === 0) el.removeAttribute('class');
}

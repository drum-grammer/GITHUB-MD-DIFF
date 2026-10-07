/**
 * GitHub 화면에 대한 가정은 전부 여기에 둔다 — 로그인한 사용자의 새 "Files changed" 화면과
 * 로그아웃 사용자에게 보이는 옛 화면(/files), 2026-10-07 확인. GitHub가 바뀌면 이 파일만 고친다.
 */
export const MDF_ATTR = 'data-mdf';
export const HIDDEN_CLASS = 'mdf-hidden';

// 새 화면 · 옛 화면
const FILE = 'div[id^="diff-"][class*="Diff-module__diff__"], div.file.js-file';
const HEADER = '[class*="DiffFileHeader-module__diff-file-header"], .file-header';
const FILE_NAME = 'h3[class*="DiffFileHeader-module__file-name"] code';
const CLASSIC_PATH = '.file-header[data-path]';
const PROSE_BODY = '.prose-diff .markdown-body';
const MD_PATH = /\.(md|markdown|mdx)$/i;
const VIEW_LABEL = { rich: 'Display the rich diff', source: 'Display the source diff' } as const;
const VIEW_ICON = { rich: 'octicon-file', source: 'octicon-code' } as const;
const COLLAPSED_LABEL = 'Expand file';
const CLASSIC_TOGGLE_LABEL = 'Toggle diff contents';
const REVIEW_THREAD = '[class*="InlineReviewThread-module__ReviewThreadContainer"], tr.inline-comments';

export type ViewKind = keyof typeof VIEW_LABEL;

export interface TablePair {
  del: HTMLElement;
  ins: HTMLElement;
  oldTable: HTMLTableElement;
  newTable: HTMLTableElement;
}

export function fileElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FILE)];
}

export function fileOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(FILE);
}

export function filePath(file: Element): string | null {
  const text = file.querySelector(FILE_NAME)?.textContent ?? file.querySelector(CLASSIC_PATH)?.getAttribute('data-path');
  const path = text?.replace(/[\u200e\u200f]/g, '').trim();
  return path || null;
}

/** 이름이 바뀐 파일은 "옛 → 새"로 나올 수 있어 마지막 낱말을 본다 */
export function isMarkdownPath(path: string): boolean {
  return MD_PATH.test(path.trim().split(/\s+/).pop() ?? '');
}

/** 버튼의 이름 — aria-label 또는 aria-labelledby가 가리키는 툴팁 글 */
function hasLabel(button: Element, label: string): boolean {
  if (button.getAttribute('aria-label') === label) return true;
  const ids = button.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
  return ids.some((id) => button.ownerDocument.getElementById(id)?.textContent?.trim() === label);
}

/** 파일 머리의 원문/렌더링 버튼 — 라벨(aria-label·툴팁)로 찾고, 없으면 새 화면 토글의 아이콘으로 */
export function viewButton(file: Element, kind: ViewKind): HTMLButtonElement | null {
  const header = file.querySelector(HEADER);
  if (!header) return null;
  const byLabel = [...header.querySelectorAll<HTMLButtonElement>('button')].find((b) => hasLabel(b, VIEW_LABEL[kind]));
  const toggles = [...header.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
  return byLabel ?? toggles.find((b) => b.querySelector(`svg.${VIEW_ICON[kind]}`)) ?? null;
}

/** 원문/렌더링 버튼이 눌린(골라진) 상태인가 — 새 화면은 aria-pressed, 옛 화면은 selected 클래스 */
export function isPressed(button: Element): boolean {
  return button.getAttribute('aria-pressed') === 'true' || button.classList.contains('selected');
}

/**
 * 접힌 파일(접기 버튼·Viewed 표시). 새 화면은 머리에 "Expand file" 버튼이 생기고 본문이 DOM에서 내려간다.
 * 옛 화면은 "Toggle diff contents" 버튼이 aria-expanded=false가 되고 본문은 숨긴 채 남는다.
 */
export function isCollapsed(file: Element): boolean {
  const header = file.querySelector(HEADER);
  if (!header) return false;
  return [...header.querySelectorAll('button')].some(
    (b) => hasLabel(b, COLLAPSED_LABEL) || (hasLabel(b, CLASSIC_TOGGLE_LABEL) && b.getAttribute('aria-expanded') === 'false'),
  );
}

/** 원문 보기에 줄 코멘트 스레드가 있는가 — 렌더링 보기는 스레드를 보여 주지 않는다 */
export function hasReviewThreads(file: Element): boolean {
  return file.querySelector(REVIEW_THREAD) !== null;
}

export function proseBody(file: ParentNode): HTMLElement | null {
  return file.querySelector<HTMLElement>(PROSE_BODY);
}

const CHANGE_CLASSES = ['vicinity', 'changed', 'added', 'removed', 'moved'];
const CHANGE_INSIDE = 'ins, del, .vicinity, .changed, .added, .removed, .moved';

/**
 * 렌더링 본문 바로 아래 블록 중 접어도 되는 것. GitHub는 변경 없는 블록을 묶음(`div.expandable.unchanged`)으로
 * 내기도 하고, 묶지 않고 블록마다 `unchanged`를 붙여 내기도 한다(2026-10-07 확인). 표·도표를 감싼 요소는 표시가 없고
 * 안쪽에만 `unchanged`가 있다. 앵커는 제목에 딸린 빈 요소다. 표시를 알 수 없으면 접지 않는다.
 */
export function isFoldable(el: Element): boolean {
  if (el.hasAttribute(MDF_ATTR)) return false;
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

/** 숨김을 켜고 끈다. 끌 때 class가 비면 속성째 지운다 — 원래 class가 없던 <del>/<ins>에 class=""가 남지 않게 */
export function setHidden(el: Element, hidden: boolean): void {
  el.classList.toggle(HIDDEN_CLASS, hidden);
  if (!hidden && el.classList.length === 0) el.removeAttribute('class');
}

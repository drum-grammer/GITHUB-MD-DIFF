/**
 * GitHub 화면에 대한 가정은 전부 여기에 둔다 — 로그인한 사용자의 새 "Files changed" 화면, 2026-10-07 확인.
 * GitHub가 바뀌면 이 파일만 고친다.
 */
export const MDF_ATTR = 'data-mdf';
export const HIDDEN_CLASS = 'mdf-hidden';

const FILE = 'div[id^="diff-"][class*="Diff-module__diff__"]';
const HEADER = '[class*="DiffFileHeader-module__diff-file-header"]';
const FILE_NAME = 'h3[class*="DiffFileHeader-module__file-name"] code';
const PROSE_BODY = '.prose-diff .markdown-body';
const MD_PATH = /\.(md|markdown|mdx)$/i;
const VIEW_LABEL = { rich: 'Display the rich diff', source: 'Display the source diff' } as const;
const VIEW_ICON = { rich: 'octicon-file', source: 'octicon-code' } as const;

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
  const text = file.querySelector(FILE_NAME)?.textContent;
  const path = text?.replace(/[‎‏]/g, '').trim();
  return path || null;
}

/** 이름이 바뀐 파일은 "옛 → 새"로 나올 수 있어 마지막 낱말을 본다 */
export function isMarkdownPath(path: string): boolean {
  return MD_PATH.test(path.trim().split(/\s+/).pop() ?? '');
}

/** 파일 머리의 원문/렌더링 버튼 — 툴팁 라벨(aria-labelledby)로 찾고, 없으면 아이콘으로 */
export function viewButton(file: Element, kind: ViewKind): HTMLButtonElement | null {
  const header = file.querySelector(HEADER);
  if (!header) return null;
  const buttons = [...header.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
  const doc = file.ownerDocument;
  const byLabel = buttons.find((b) => {
    if (b.getAttribute('aria-label') === VIEW_LABEL[kind]) return true;
    const ids = b.getAttribute('aria-labelledby')?.split(/\s+/) ?? [];
    return ids.some((id) => doc.getElementById(id)?.textContent?.trim() === VIEW_LABEL[kind]);
  });
  return byLabel ?? buttons.find((b) => b.querySelector(`svg.${VIEW_ICON[kind]}`)) ?? null;
}

export function proseBody(file: ParentNode): HTMLElement | null {
  return file.querySelector<HTMLElement>(PROSE_BODY);
}

/** 렌더링 본문 바로 아래의 변경 없는 묶음 */
export function unchangedRuns(body: Element): HTMLElement[] {
  return ([...body.children] as HTMLElement[]).filter(
    (c) => c.classList.contains('expandable') && c.classList.contains('unchanged'),
  );
}

/** 최상위 <del>(표 하나) 바로 뒤 <ins>(표 하나) 쌍 — GitHub는 표가 조금만 바뀌어도 옛 표 전체·새 표 전체를 이렇게 낸다 */
export function tablePairs(body: Element): TablePair[] {
  const out: TablePair[] = [];
  for (const del of [...body.children] as HTMLElement[]) {
    if (del.tagName !== 'DEL') continue;
    const ins = del.nextElementSibling as HTMLElement | null;
    if (!ins || ins.tagName !== 'INS') continue;
    const oldTables = del.querySelectorAll('table');
    const newTables = ins.querySelectorAll('table');
    if (oldTables.length !== 1 || newTables.length !== 1) continue;
    out.push({ del, ins, oldTable: oldTables[0], newTable: newTables[0] });
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

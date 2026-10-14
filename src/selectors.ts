/**
 * GitHub 화면에 대한 가정은 전부 여기에 둔다 — 로그인한 사용자의 새 "Files changed" 화면과
 * 로그아웃 사용자에게 보이는 옛 화면(/files), 2026-10-07 확인. GitHub가 바뀌면 이 파일만 고친다.
 *
 * 2026-10-14 GitHub가 새 화면의 클래스 이름을 `Diff-module__diff__해시`에서 `diff__해시`로 바꿔 1.5.0이 로그인 화면에서
 * 아무 말 없이 멈췄다. 그래서 단서를 세 겹으로 둔다(docs/runbooks/github-ui-change.md):
 * 1. 잘 안 바뀌는 것이 먼저 — 파일 앵커 id(`diff-<해시>`, PR 파일 링크 주소), 버튼 라벨(aria), 구조(머리의 h3)
 * 2. 해시 클래스는 두 형식을 다 받는다(`moduleClass`) — GitHub가 옛 형식으로 되돌려도 그대로 돈다
 * 3. 그래도 못 찾으면 조용히 멈추지 않고 알린다(`pageStructure` → problems.ts `structureProblem`)
 */
export const MDF_ATTR = 'data-mdf';
export const HIDDEN_CLASS = 'mdf-hidden';

/**
 * CSS 모듈 클래스 하나를 두 형식으로 — `Module-module__local__해시`(2026-10-07)와 `local__해시`(2026-10-14).
 * 앞의 것은 모듈 이름까지, 뒤의 것은 클래스 낱말이 `local__`로 시작하는 것만 맞춘다. prefix는 각 갈래 앞에 붙인다
 */
export function moduleClass(module: string, local: string, prefix = ''): string {
  return [`[class*="${module}-module__${local}__"]`, `[class^="${local}__"]`, `[class*=" ${local}__"]`].map((c) => prefix + c).join(', ');
}

// 새 화면 · 옛 화면
/** 파일 앵커 id — `diff-` + 경로 해시(16진수). PR 파일 링크(`#diff-…`) 주소라 클래스 이름보다 오래 간다(2026-10-07·10-14 같음) */
const FILE_ID = /^diff-[0-9a-f]+$/;
const CLASSIC_FILE = 'div.file.js-file';
const FILE_CANDIDATE = `div[id^="diff-"], ${CLASSIC_FILE}`;
const FILE_CLASS = moduleClass('Diff', 'diff', 'div[id^="diff-"]');
const HEADER = `${moduleClass('DiffFileHeader', 'diff-file-header')}, .file-header`;
const FILE_NAME_HEADING = moduleClass('DiffFileHeader', 'file-name', 'h3');
const CLASSIC_PATH = '.file-header[data-path]';
/** 파일 머리·파일 트리의 파일 링크 — 파일 묶음을 못 찾았는데 이것이 있으면 GitHub 화면이 바뀐 것이다 */
const FILE_LINK = 'a[href^="#diff-"]';
const PROSE_BODY = '.prose-diff .markdown-body';
/** 렌더링된 글·코멘트 — 그 안의 h3는 파일 이름이 아니다 */
const NOT_HEADER = '.prose-diff, .markdown-body, [data-mdf]';
const MD_PATH = /\.(md|markdown|mdx)$/i;
const VIEW_LABEL = { rich: 'Display the rich diff', source: 'Display the source diff' } as const;
const VIEW_ICON = { rich: 'octicon-file', source: 'octicon-code' } as const;
const COLLAPSED_LABEL = 'Expand file';
const CLASSIC_TOGGLE_LABEL = 'Toggle diff contents';
const REVIEW_THREAD = `${moduleClass('InlineReviewThread', 'ReviewThreadContainer')}, tr.inline-comments`;

export type ViewKind = keyof typeof VIEW_LABEL;

export interface TablePair {
  del: HTMLElement;
  ins: HTMLElement;
  oldTable: HTMLTableElement;
  newTable: HTMLTableElement;
}

/** 파일 묶음인가 — 앵커 id가 1순위, 해시 클래스(두 형식)와 옛 화면 클래스도 받는다. 파일들을 감싼 큰 상자(`diff-comparison-…`)는 아니다 */
function isFileElement(el: Element): boolean {
  return el.tagName === 'DIV' && (FILE_ID.test(el.id) || el.matches(FILE_CLASS) || el.matches(CLASSIC_FILE));
}

export function fileElements(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FILE_CANDIDATE)].filter(isFileElement);
}

export function fileOf(el: Element): HTMLElement | null {
  let cur = el.closest<HTMLElement>(FILE_CANDIDATE);
  while (cur && !isFileElement(cur)) cur = cur.parentElement?.closest<HTMLElement>(FILE_CANDIDATE) ?? null;
  return cur;
}

/** 파일 이름 머리글(h3) — 클래스로 찾고, 못 찾으면 렌더링된 글 밖에서 `code`를 품은 첫 h3 */
function fileNameHeading(file: Element): Element | null {
  return file.querySelector(FILE_NAME_HEADING) ?? [...file.querySelectorAll('h3')].find((h) => h.querySelector('code') && !h.closest(NOT_HEADER)) ?? null;
}

/** 파일 머리 — 클래스로 찾고, 못 찾으면 파일 이름(h3)을 품은 파일 바로 아래 칸(2026-10-14 화면은 머리를 한 겹 더 감싼다) */
function headerOf(file: Element): Element | null {
  const byClass = file.querySelector(HEADER);
  if (byClass) return byClass;
  const heading = fileNameHeading(file);
  return heading ? ([...file.children].find((c) => c.contains(heading)) ?? null) : null;
}

/** 이름이 바뀐 파일의 화면 낭독기용 글 — "옛 경로 renamed to 새 경로"(보이는 쪽은 새 경로를 "…"로 줄인다, 2026-10-08 확인) */
const RENAMED_TO = ' renamed to ';

export function filePath(file: Element): string | null {
  const code = fileNameHeading(file)?.querySelector('code');
  const spoken = code?.querySelector('.sr-only')?.textContent ?? '';
  const text = spoken.includes(RENAMED_TO)
    ? spoken.split(RENAMED_TO).pop()
    : (code?.textContent ?? file.querySelector(CLASSIC_PATH)?.getAttribute('data-path'));
  const path = text?.replace(/[‎‏]/g, '').trim();
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
  const header = headerOf(file);
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
  const header = headerOf(file);
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

/** 파일 내용이 아직 안 왔다 — 큰 PR은 화면에 가까운 파일만 채우고 나머지는 뼈대로 둔다(2026-10-08 확인) */
const LOADING_SKELETON = moduleClass('LoadingSkeleton', 'skeleton');
/** 원문 diff의 본문 — 줄이 있으면 <table>, 줄 대신 안내 글이면 <div>(2026-10-08 확인) */
const DIFF_ANCHOR = '[data-diff-anchor]';
/** 큰 diff의 "Load diff" 자리 — GitHub가 기본으로 그리지 않을 뿐 렌더링 보기는 대개 된다. 클래스를 못 찾으면 버튼 글로 */
const LARGE_DIFF = `[class*="HiddenDiffPatch-module"], ${moduleClass('HiddenDiffPatch', 'gridColumnTemplate')}`;
const LOAD_DIFF = /^load diff$/i;

export function isLoadingPlaceholder(file: Element): boolean {
  return file.querySelector(LOADING_SKELETON) !== null;
}

/** 원문 보기가 줄 대신 안내 글을 보여 주는가 — "File renamed without changes.", 큰 diff의 "Load Diff" 등 */
export function showsDiffNotice(file: Element): boolean {
  const anchor = file.querySelector(DIFF_ANCHOR);
  return anchor !== null && anchor.tagName !== 'TABLE' && !anchor.closest('.prose-diff');
}

/** 안내 글이 큰 diff의 "Load Diff"인가 — 렌더링 보기로 바꿔 볼 만하다(실패하면 15초 뒤 원문으로 되돌린다) */
export function isLargeDiffPlaceholder(file: Element): boolean {
  if (file.querySelector(LARGE_DIFF)) return true;
  const anchor = file.querySelector(DIFF_ANCHOR);
  return anchor !== null && [...anchor.querySelectorAll('button')].some((b) => LOAD_DIFF.test(b.textContent?.trim() ?? ''));
}

/** 화면에서 읽은 것 — 파일 묶음 수, 이름을 읽은 파일 수, 뼈대인 파일 수, 파일 링크 수 */
export interface PageStructure {
  files: number;
  named: number;
  loading: number;
  links: number;
}

/**
 * 확장이 이 화면을 읽고 있는가를 셀 거리 — problems.ts `structureProblem`이 판정한다.
 * 경로 읽기는 content.ts가 기억해 둔 것을 쓸 수 있게 받는다(큰 PR에서 훑을 때마다 다시 읽지 않게)
 */
export function pageStructure(doc: Document, files = fileElements(doc), pathOf: (f: HTMLElement) => string | null = filePath): PageStructure {
  let named = 0;
  let loading = 0;
  for (const f of files) {
    if (pathOf(f)) named++;
    else if (isLoadingPlaceholder(f)) loading++;
  }
  return { files: files.length, named, loading, links: doc.querySelectorAll(FILE_LINK).length };
}

/**
 * 시험·스크립트(브라우저 안)가 확장과 같은 가정을 쓰게 — 여기만 고치면 E2E·테스트 저장소·canary·탐험이 같이 따라온다.
 * file은 브라우저용 구조 선택자다(`:has`): 파일 이름(h3 code)을 품고 안에 다른 diff- 상자가 없는 diff- 상자, 또는 옛 화면 파일
 */
export const GITHUB_CSS = {
  file: `div[id^="diff-"]:has(h3 code):not(:has(div[id^="diff-"])), ${CLASSIC_FILE}`,
  fileName: 'h3 code',
  header: HEADER,
  reviewThread: REVIEW_THREAD,
  skeleton: LOADING_SKELETON,
  largeDiff: LARGE_DIFF,
  fileLink: FILE_LINK,
  /** 클래스 이름 형식 점검(canary) — 새 화면 파일 묶음을 해시 클래스로 찾는 두 갈래 */
  fileClassOld: 'div[id^="diff-"][class*="Diff-module__diff__"]',
  fileClassNew: 'div[id^="diff-"][class^="diff__"], div[id^="diff-"][class*=" diff__"]',
} as const;

/** 렌더링된 마크다운에만 있는 요소 — 원문 diff 표·불러오기 표시(스피너)·빈 상자에는 없다 */
const RENDERED_CONTENT = 'p, li, blockquote, img, iframe, h1, h2, h4, h5, h6';

/**
 * 렌더링 본문(.prose-diff)은 없는데 파일 머리 밖에 렌더링된 글이 보이는가 — 그러면 GitHub가 렌더링 보기의 구조를 바꾼 것이다.
 * 없으면(빈 상자·불러오는 중) GitHub가 그 파일의 렌더링을 아직 못 만들었거나 실패한 것이다(큰 파일에서 504, 2026-10-08 확인).
 */
export function hasUnknownRendering(file: Element): boolean {
  if (proseBody(file)) return false;
  const header = headerOf(file);
  return [...file.querySelectorAll(RENDERED_CONTENT)].some((el) => !header?.contains(el) && !el.closest(`[${MDF_ATTR}]`));
}

const CHANGE_CLASSES = ['vicinity', 'changed', 'added', 'removed', 'moved'];
const CHANGE_INSIDE = 'ins, del, .vicinity, .changed, .added, .removed, .moved';

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

/** 코멘트·스레드가 붙은 블록의 맨 위 묶음 — 접지 않는다 */
export const PIN_ATTR = 'data-mdf-pin';

/** 어느 "Files changed" 화면인가 — 문제 보고에 적는다 */
export function pageVariant(doc: Document): 'new' | 'classic' | 'unknown' {
  if (doc.querySelector(CLASSIC_FILE)) return 'classic';
  return fileElements(doc).length > 0 ? 'new' : 'unknown';
}

/** 로그인했는가 — 코멘트는 로그인한 사람만 단다 */
export function isSignedIn(doc: Document): boolean {
  return Boolean(doc.querySelector('meta[name="user-login"]')?.getAttribute('content'));
}

/** 코멘트를 붙이는 블록 — 제목·문단·목록 항목·표 행·코드 */
export const COMMENT_BLOCK = 'h1, h2, h3, h4, h5, h6, p, li, tr, pre';
/** 렌더링 diff에서 블록째 지운 내용 — 블록을 감싼 <del> 또는 .removed(2026-10-08 확인) */
export const REMOVED_BLOCK = 'del, .removed';
/** 고친 블록 안의 글자 단위 변경 — 새 파일 쪽 글에서는 <del>을, 원래 파일 쪽 글에서는 <ins>를 뺀다 */
export const INLINE_DELETED = 'del';
export const INLINE_INSERTED = 'ins';
/** 코멘트 상자를 감싼 바꾸기 표시를 벗어날 때 보는 것 — 상자가 취소선·밑줄을 물려받지 않게 */
export const CHANGE_WRAPPER = 'ins, del, .added, .removed';

/** 옛 화면은 .prose-diff.collapsed로 묶음 내용을 숨긴다. 확장이 접기를 맡는 동안 떼어 두고 이 속성으로 표시한다 */
export const UNCOLLAPSED_ATTR = 'data-mdf-uncollapsed';

/** 숨김을 켜고 끈다. 끌 때 class가 비면 속성째 지운다 — 원래 class가 없던 <del>/<ins>에 class=""가 남지 않게 */
export function setHidden(el: Element, hidden: boolean): void {
  el.classList.toggle(HIDDEN_CLASS, hidden);
  if (!hidden && el.classList.length === 0) el.removeAttribute('class');
}

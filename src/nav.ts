import { t } from './i18n';
import { HIDDEN_CLASS, MDF_ATTR, isDecoration } from './selectors';

/** GitHub 렌더링 diff의 바뀐 곳 표시 — 바뀐 곳 옆 문맥(.vicinity)은 바뀐 것이 아니다 */
const CHANGE = 'ins, del, .changed, .added, .removed, .moved';
/** 합친 표에서 바뀐 행 */
const CHANGED_ROW = '.mdf-row-added, .mdf-row-removed, .mdf-row-changed';
const THREAD = `[${MDF_ATTR}="thread"]`;
const BODY = '.prose-diff .markdown-body';
const STATUS = 'nav-status';

export type NavKind = 'change' | 'thread';

/** 본문 바로 아래 블록이 바뀐 곳인가. 확장이 만든 것은 합친 표만 본다(스레드 본문의 취소선 등은 변경이 아니다) */
function isChange(el: Element): boolean {
  if (el.classList.contains(HIDDEN_CLASS)) return false;
  const mdf = el.getAttribute(MDF_ATTR);
  if (mdf === 'table') return el.querySelector(CHANGED_ROW) !== null;
  if (mdf !== null) return false;
  if (el.matches(CHANGE)) return true;
  return [...el.querySelectorAll(CHANGE)].some((c) => !c.closest(`[${MDF_ATTR}]`));
}

/**
 * 바뀐 곳 사이에 있어도 묶음을 끊지 않는 것 — 확장이 넣은 상자(스레드·코멘트 상자·"+"), 합친 표 뒤의 숨긴 원래 표, 제목 앵커.
 * 접기 막대는 변경 없는 블록을 대신하므로 끊는다
 */
function isTransparent(el: Element): boolean {
  const mdf = el.getAttribute(MDF_ATTR);
  if (mdf !== null) return mdf !== 'fold' && mdf !== 'table';
  if (el.classList.contains(HIDDEN_CLASS) && (el.tagName === 'DEL' || el.tagName === 'INS')) return true;
  return isDecoration(el);
}

/** 파일 하나의 바뀐 곳 — 이어진 바뀐 블록은 한 곳이다. 각 곳의 첫 블록을 문서 순서로 */
export function changeTargets(body: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let open = false;
  for (const el of body.children as HTMLCollectionOf<HTMLElement>) {
    if (isChange(el)) {
      if (!open) out.push(el);
      open = true;
    } else if (!isTransparent(el)) open = false;
  }
  return out;
}

/** 파일 툴바의 한 줄 요약 — "변경 8곳 · 스레드 3개(미해결 2)". 바뀐 곳이 없으면 null */
export function summaryOf(body: HTMLElement): string | null {
  const changes = changeTargets(body).length;
  if (changes === 0) return null;
  const parts = [changes === 1 ? t('navChangesOne') : t('navChanges', [changes])];
  const threads = [...body.querySelectorAll<HTMLElement>(THREAD)];
  if (threads.length) {
    const open = threads.filter((x) => x.dataset.resolved !== 'true').length;
    parts.push(threads.length === 1 ? t('navThreadsOne', [open]) : t('navThreads', [threads.length, open]));
  }
  return parts.join(' · ');
}

const visible = (el: Element): boolean => el.getClientRects().length > 0;

/** 페이지(또는 파일 하나)에서 이동할 곳 — 문서 순서, 보이는 것만 */
function targets(root: ParentNode, kind: NavKind): HTMLElement[] {
  const bodies = root instanceof HTMLElement && root.matches('.markdown-body') ? [root] : [...root.querySelectorAll<HTMLElement>(BODY)];
  const list = kind === 'change' ? bodies.flatMap(changeTargets) : bodies.flatMap((b) => [...b.querySelectorAll<HTMLElement>(THREAD)]);
  return list.filter(visible);
}

/** 이동한 블록이 화면 위에서 이만큼 아래에 오게 한다(GitHub의 고정 머리 아래) */
const TOP_RATIO = 0.3;

/**
 * 그 블록에만 잠깐 scroll-margin-top을 주고 맞춘다. 모든 블록에 CSS로 주면 다른 스크롤(찾기·테스트 도구의 자동 스크롤)까지
 * 30% 내려 맞춰져, 범위를 끌 때 끝 블록이 화면 밖으로 밀렸다(테스트 저장소 T07이 가끔 실패)
 */
function scrollToRef(el: HTMLElement): void {
  const old = el.style.scrollMarginTop;
  el.style.scrollMarginTop = `${TOP_RATIO * 100}vh`;
  el.scrollIntoView({ block: 'start' });
  el.style.scrollMarginTop = old;
  if (!el.getAttribute('style')) el.removeAttribute('style');
}
let cursor: { el: Element; top: number } | null = null;

/** 감싼 <del>/<ins>는 줄 단위 상자라 테두리가 어색하다 — 안의 첫 블록을 비춘다 */
const shown = (el: HTMLElement): HTMLElement =>
  (el.tagName === 'DEL' || el.tagName === 'INS') && el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el;

/**
 * 다음(1)·이전(-1) 바뀐 곳이나 스레드로 간다. 방금 이 기능으로 간 곳이 아직 그 자리 근처면(화면 1/4 안) 그 다음으로,
 * 사람이 화면을 크게 움직였으면 지금 화면 기준(위에서 30%)으로 찾는다. 갔으면 true.
 * 근처를 넉넉히 보는 까닭: GitHub가 아래 파일을 마저 그리면 간 곳이 몇 px 밀려, 같은 곳으로 다시 가던 것(테스트 저장소 T15)
 */
export function jump(doc: Document, kind: NavKind, dir: 1 | -1, scope: ParentNode = doc, origin?: Element): boolean {
  const list = targets(scope, kind);
  if (list.length === 0) {
    status(doc, t(kind === 'change' ? 'navNoChanges' : 'navNoThreads'));
    return false;
  }
  const ref = (doc.defaultView?.innerHeight ?? 0) * TOP_RATIO;
  const at = cursor ? list.indexOf(cursor.el as HTMLElement) : -1;
  let i: number;
  const near = (doc.defaultView?.innerHeight ?? 0) / 4;
  // 파일 툴바의 ↓는 누른 버튼 아래부터 — 툴바는 파일 맨 위라 그 파일의 첫 바뀐 곳이 화면 30% 선보다 위에 있어도 간다
  const below = origin ? origin.getBoundingClientRect().bottom : ref + 4;
  if (cursor && at >= 0 && Math.abs(cursor.el.getBoundingClientRect().top - cursor.top) < near) i = at + dir;
  else if (dir > 0) i = list.findIndex((el) => el.getBoundingClientRect().top > below);
  else {
    i = -1;
    list.forEach((el, k) => {
      if (el.getBoundingClientRect().top < ref - 4) i = k;
    });
  }
  if (i < 0 || i >= list.length) {
    const end = dir > 0 ? 'Last' : 'First';
    status(doc, t(kind === 'change' ? `nav${end}Change` : `nav${end}Thread`));
    return false;
  }
  const el = list[i];
  scrollToRef(el);
  cursor = { el, top: el.getBoundingClientRect().top };
  flash(shown(el));
  status(doc, t(kind === 'change' ? 'navAtChange' : 'navAtThread', [i + 1, list.length]));
  return true;
}

function flash(el: HTMLElement): void {
  el.classList.remove('mdf-flash');
  void el.offsetWidth; // 같은 곳을 다시 비출 때 애니메이션을 처음부터
  el.classList.add('mdf-flash');
  setTimeout(() => el.classList.remove('mdf-flash'), 1200);
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;

/** 화면 아래 가운데의 짧은 안내("변경 3 / 8") — 화면 읽기 프로그램에도 읽힌다 */
function status(doc: Document, text: string): void {
  let box = doc.querySelector<HTMLElement>(`[${MDF_ATTR}="${STATUS}"]`);
  if (!box) {
    box = doc.createElement('div');
    box.setAttribute(MDF_ATTR, STATUS);
    box.className = 'mdf-nav-status';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    doc.body.append(box);
  }
  box.textContent = text;
  box.classList.add('mdf-on');
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => box.classList.remove('mdf-on'), 1600);
}

/** 글을 쓰는 중인가 — 입력란·편집 영역에서는 단축키를 가로채지 않는다 */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
}

const KEYS: Record<string, [NavKind, 1 | -1]> = {
  ']': ['change', 1],
  '[': ['change', -1],
  '}': ['thread', 1],
  '{': ['thread', -1],
};

/**
 * `]`·`[` 다음·이전 바뀐 곳, `}`·`{` 다음·이전 스레드. GitHub "Files changed" 화면에는 이 키가 없다(2026-10-09 확인).
 * `active`가 거짓이거나(꺼짐·PR 화면 아님) 렌더링 본문이 하나도 없으면 키를 그대로 둔다
 */
export function installNavKeys(doc: Document, active: () => boolean): void {
  doc.addEventListener('keydown', (e) => {
    const key = KEYS[e.key];
    if (!key || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (!active() || typing(e.target) || !doc.querySelector(BODY)) return;
    e.preventDefault();
    jump(doc, key[0], key[1]);
  });
}

import { foldBars, setFoldExpanded } from './fold';
import { t } from './i18n';
import { jump, summaryOf } from './nav';
import { MDF_ATTR } from './selectors';
import { setTableAllRows } from './table-render';

const TOOLBAR = 'file-toolbar';
const EXPAND = 'mdf-expand';
const SUMMARY = 'mdf-summary';
const NAV = 'mdf-nav';

/** 파일 하나의 본문 묶음과 표의 같은 행을 모두 펼치거나 바뀐 부분만으로 되돌린다 */
export function setFileExpanded(body: HTMLElement, expanded: boolean): void {
  for (const bar of foldBars(body)) setFoldExpanded(bar, expanded);
  for (const wrap of body.querySelectorAll<HTMLElement>(`[${MDF_ATTR}="table"]`)) setTableAllRows(wrap, expanded);
  const b = body.querySelector<HTMLElement>(`[${MDF_ATTR}="${TOOLBAR}"] .${EXPAND}`);
  if (b) {
    b.setAttribute('aria-pressed', String(expanded));
    b.textContent = expanded ? t('changedOnly') : t('expandAll');
  }
}

function button(doc: Document, className: string, text: string): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = `mdf-btn ${className}`;
  b.textContent = text;
  return b;
}

/**
 * 렌더링 diff 맨 위의 파일 툴바를 지금 본문에 맞춘다 — 접을 것이 있으면 "모두 펼치기 ↔ 바뀐 부분만",
 * 바뀐 곳이 있으면 요약("변경 8곳 · 스레드 3개(미해결 2)")과 이 파일 안 이전·다음 변경 버튼.
 * 바뀐 것이 없으면 DOM을 건드리지 않는다(본문이 바뀔 때마다 불린다). 툴바를 새로 만들었으면 true.
 * GitHub가 그리는 파일 머리에는 넣지 않는다 — React가 다시 그릴 때 충돌한다.
 */
export function syncFileToolbar(body: HTMLElement): boolean {
  const doc = body.ownerDocument;
  let bar = body.querySelector<HTMLElement>(`[${MDF_ATTR}="${TOOLBAR}"]`);
  const foldable = foldBars(body).length > 0 || body.querySelector(`[${MDF_ATTR}="table"]`) !== null;
  const summary = summaryOf(body);
  if (!bar && !foldable && !summary) return false;
  const made = !bar;
  if (!bar) {
    bar = doc.createElement('div');
    bar.className = 'mdf-toolbar';
    bar.setAttribute(MDF_ATTR, TOOLBAR);
    body.prepend(bar);
  }
  if (foldable && !bar.querySelector(`.${EXPAND}`)) {
    const b = button(doc, EXPAND, t('expandAll'));
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => setFileExpanded(body, b.getAttribute('aria-pressed') !== 'true'));
    bar.prepend(b); // 첫 버튼 — 테스트·사람 모두 "모두 펼치기"를 맨 앞에서 찾는다(보이는 순서는 CSS)
  }
  let info = bar.querySelector<HTMLElement>(`.${SUMMARY}`);
  if (summary) {
    if (!info) {
      info = doc.createElement('span');
      info.className = SUMMARY;
      info.title = t('navHelp');
      const prev = button(doc, NAV, '↑');
      const next = button(doc, NAV, '↓');
      prev.setAttribute('aria-label', t('navPrev'));
      prev.title = t('navPrev');
      next.setAttribute('aria-label', t('navNext'));
      next.title = t('navNext');
      prev.addEventListener('click', () => jump(doc, 'change', -1, body));
      next.addEventListener('click', () => jump(doc, 'change', 1, body, next));
      bar.append(info, prev, next);
    }
    if (info.textContent !== summary) info.textContent = summary;
  } else if (info) {
    info.remove();
    for (const b of bar.querySelectorAll(`.${NAV}`)) b.remove();
  }
  return made;
}

import { foldBars, setFoldExpanded } from './fold';
import { t } from './i18n';
import { MDF_ATTR } from './selectors';
import { setTableAllRows } from './table-render';

const TOOLBAR = 'file-toolbar';

/** 파일 하나의 본문 묶음과 표의 같은 행을 모두 펼치거나 바뀐 부분만으로 되돌린다 */
export function setFileExpanded(body: HTMLElement, expanded: boolean): void {
  for (const bar of foldBars(body)) setFoldExpanded(bar, expanded);
  for (const wrap of body.querySelectorAll<HTMLElement>(`[${MDF_ATTR}="table"]`)) setTableAllRows(wrap, expanded);
  const b = body.querySelector<HTMLElement>(`[${MDF_ATTR}="${TOOLBAR}"] button`);
  if (b) {
    b.setAttribute('aria-pressed', String(expanded));
    b.textContent = expanded ? t('changedOnly') : t('expandAll');
  }
}

/**
 * 접을 것이 있는 파일의 렌더링 diff 맨 위에 "모두 펼치기 ↔ 바뀐 부분만" 버튼을 단다.
 * GitHub가 그리는 파일 머리에는 넣지 않는다 — React가 다시 그릴 때 충돌한다.
 */
export function addFileToolbar(body: HTMLElement): boolean {
  if (body.querySelector(`[${MDF_ATTR}="${TOOLBAR}"]`)) return false;
  if (foldBars(body).length === 0 && !body.querySelector(`[${MDF_ATTR}="table"]`)) return false;
  const doc = body.ownerDocument;
  const bar = doc.createElement('div');
  bar.className = 'mdf-toolbar';
  bar.setAttribute(MDF_ATTR, TOOLBAR);
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'mdf-btn';
  b.setAttribute('aria-pressed', 'false');
  b.textContent = t('expandAll');
  b.addEventListener('click', () => setFileExpanded(body, b.getAttribute('aria-pressed') !== 'true'));
  bar.append(b);
  body.prepend(bar);
  return true;
}

import { t } from './i18n';
import { MDF_ATTR, isAnchor, setHidden, unchangedRuns } from './selectors';

const BAR = 'fold';

export function foldBars(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${MDF_ATTR}="${BAR}"]`)];
}

/** 막대 바로 뒤 묶음을 펼치거나 접는다 */
export function setFoldExpanded(bar: HTMLElement, expanded: boolean): void {
  const run = bar.nextElementSibling;
  if (run) setHidden(run, !expanded);
  bar.setAttribute('aria-expanded', String(expanded));
  const arrow = bar.querySelector('.mdf-arrow');
  if (arrow) arrow.textContent = expanded ? '▾' : '▸';
}

/** 변경 없는 묶음마다 접기 막대를 붙이고 묶음을 숨긴다. 이미 막대가 있는 묶음은 건너뛴다. 새로 만든 막대 수를 돌려준다 */
export function foldUnchanged(body: HTMLElement): number {
  const doc = body.ownerDocument;
  let made = 0;
  for (const run of unchangedRuns(body)) {
    if (run.previousElementSibling?.getAttribute(MDF_ATTR) === BAR) continue;
    const blocks = [...run.children].filter((c) => !isAnchor(c));
    if (blocks.length === 0) continue;
    const headings = run.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const last = headings[headings.length - 1]?.textContent?.trim();
    const label = last ? t('foldBlocksHeading', [blocks.length, last]) : t('foldBlocks', [blocks.length]);

    const bar = doc.createElement('button');
    bar.type = 'button';
    bar.className = 'mdf-fold';
    bar.setAttribute(MDF_ATTR, BAR);
    const arrow = doc.createElement('span');
    arrow.className = 'mdf-arrow';
    const text = doc.createElement('span');
    text.textContent = label;
    bar.append(arrow, text);
    bar.addEventListener('click', () => setFoldExpanded(bar, bar.getAttribute('aria-expanded') !== 'true'));
    run.before(bar);
    setFoldExpanded(bar, false);
    made++;
  }
  return made;
}

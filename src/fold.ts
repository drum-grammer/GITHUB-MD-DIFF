import { t } from './i18n';
import { MDF_ATTR, isAnchor, isFoldable, setHidden } from './selectors';

const BAR = 'fold';
const HEADING = /^H[1-6]$/;

export function foldBars(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${MDF_ATTR}="${BAR}"]`)];
}

/** 막대 바로 뒤에 이어지는 접어도 되는 블록들 */
function runAfter(bar: Element): Element[] {
  const run: Element[] = [];
  for (let el = bar.nextElementSibling; el && isFoldable(el); el = el.nextElementSibling) run.push(el);
  return run;
}

/** 막대 뒤 묶음을 펼치거나 접는다 */
export function setFoldExpanded(bar: HTMLElement, expanded: boolean): void {
  for (const el of runAfter(bar)) setHidden(el, !expanded);
  bar.setAttribute('aria-expanded', String(expanded));
  const arrow = bar.querySelector('.mdf-arrow');
  if (arrow) arrow.textContent = expanded ? '▾' : '▸';
}

/** 보이는 블록 수 — 앵커는 빼고, GitHub가 묶어 둔 묶음은 그 안의 블록을 센다 */
function countBlocks(run: Element[]): number {
  let n = 0;
  for (const el of run) {
    if (isAnchor(el)) continue;
    n += el.classList.contains('expandable') ? [...el.children].filter((c) => !isAnchor(c)).length : 1;
  }
  return n;
}

function lastHeading(run: Element[]): string | undefined {
  let text: string | undefined;
  for (const el of run) {
    const inside = el.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const last = inside.length ? inside[inside.length - 1] : HEADING.test(el.tagName) ? el : null;
    text = last?.textContent?.trim() || text;
  }
  return text;
}

/**
 * 연속된 변경 없는 블록마다 접기 막대를 붙이고 숨긴다. 이미 막대가 있는 묶음은 건너뛴다. 새로 만든 막대 수를 돌려준다.
 * 묶음은 앵커로 시작하지 않는다 — 바뀐 제목 바로 뒤 앵커는 그 제목의 것이다.
 */
export function foldUnchanged(body: HTMLElement): number {
  const doc = body.ownerDocument;
  const kids = [...body.children];
  let made = 0;
  let i = 0;
  while (i < kids.length) {
    if (!isFoldable(kids[i]) || isAnchor(kids[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < kids.length && isFoldable(kids[j])) j++;
    const run = kids.slice(i, j);
    i = j;
    if (run[0].previousElementSibling?.getAttribute(MDF_ATTR) === BAR) continue;
    const blocks = countBlocks(run);
    if (blocks === 0) continue;
    const heading = lastHeading(run);
    const one = blocks === 1;
    const label = heading
      ? one ? t('foldBlockOneHeading', [heading]) : t('foldBlocksHeading', [blocks, heading])
      : one ? t('foldBlockOne') : t('foldBlocks', [blocks]);

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
    run[0].before(bar);
    setFoldExpanded(bar, false);
    made++;
  }
  return made;
}

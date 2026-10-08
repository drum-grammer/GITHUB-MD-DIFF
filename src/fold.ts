import { t } from './i18n';
import { MDF_ATTR, PIN_ATTR, UNCOLLAPSED_ATTR, isAnchor, isDecoration, isFoldable, setHidden } from './selectors';

const BAR = 'fold';
const HEADING = /^H[1-6]$/;

export function foldBars(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${MDF_ATTR}="${BAR}"]`)];
}

/** GitHub가 변경 없는 블록을 하나로 묶어 둔 것(`div.expandable.unchanged`) */
function isUnchangedGroup(el: Element): boolean {
  return el.classList.contains('expandable') && el.classList.contains('unchanged');
}

/** 코멘트가 붙어 고정된 묶음 — 묶음째 펼치지 않고 그 안에서 다시 접는다 */
function isPinnedGroup(el: Element): boolean {
  return isUnchangedGroup(el) && el.hasAttribute(PIN_ATTR);
}

/** 접어도 되는가 — 고정된 묶음 안에서는 고정되지 않은 자식 모두(묶음 전체가 변경 없음), 그 밖에는 isFoldable */
function foldableIn(el: Element): boolean {
  const parent = el.parentElement;
  if (parent && isPinnedGroup(parent)) return !el.hasAttribute(MDF_ATTR) && !el.hasAttribute(PIN_ATTR);
  return isFoldable(el);
}

/** 막대 바로 뒤에 이어지는 접어도 되는 블록들 */
function runAfter(bar: Element): Element[] {
  const run: Element[] = [];
  for (let el = bar.nextElementSibling; el && foldableIn(el); el = el.nextElementSibling) run.push(el);
  return run;
}

/** 막대 뒤 묶음을 펼치거나 접는다 */
export function setFoldExpanded(bar: HTMLElement, expanded: boolean): void {
  for (const el of runAfter(bar)) setHidden(el, !expanded);
  bar.setAttribute('aria-expanded', String(expanded));
  const arrow = bar.querySelector('.mdf-arrow');
  if (arrow) arrow.textContent = expanded ? '▾' : '▸';
}

/** 보이는 블록 수 — 앵커·펼치기 아이콘은 빼고, GitHub가 묶어 둔 묶음은 그 안의 블록을 센다 */
function countBlocks(run: Element[]): number {
  let n = 0;
  for (const el of run) {
    if (isDecoration(el)) continue;
    n += el.classList.contains('expandable') ? [...el.children].filter((c) => !isDecoration(c)).length : 1;
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
 * 접기를 다시 짠다 — 막대를 걷고 `change`(블록 고정·코멘트 상자 넣기)를 한 뒤 다시 접는다.
 * 펼쳐 둔 묶음에 있던 블록이 든 새 묶음은 펼친 채로 둔다.
 */
export function refold(body: HTMLElement, change: () => void): void {
  const open = new Set<Element>();
  for (const bar of foldBars(body)) {
    const expanded = bar.getAttribute('aria-expanded') === 'true';
    for (const el of runAfter(bar)) {
      if (expanded) open.add(el);
      setHidden(el, false);
    }
    bar.remove();
  }
  change();
  foldUnchanged(body);
  for (const bar of foldBars(body)) {
    if (runAfter(bar).some((el) => open.has(el))) setFoldExpanded(bar, true);
  }
}

/**
 * 연속된 변경 없는 블록마다 접기 막대를 붙이고 숨긴다. 이미 막대가 있는 묶음은 건너뛴다. 새로 만든 막대 수를 돌려준다.
 * 묶음은 앵커로 시작하지 않는다 — 바뀐 제목 바로 뒤 앵커는 그 제목의 것이다.
 * 보일 블록이 없는 묶음(아이콘·앵커뿐)은 막대 없이 숨긴다.
 */
export function foldUnchanged(body: HTMLElement): number {
  // 옛 화면: GitHub가 묶음 내용을 숨겨 두면 막대를 펼쳐도 아이콘만 보인다 — 숨기기는 확장이 맡는다
  const prose = body.closest('.prose-diff');
  if (prose?.classList.contains('collapsed')) {
    prose.classList.remove('collapsed');
    prose.setAttribute(UNCOLLAPSED_ATTR, '');
  }
  let made = foldChildren(body);
  // 코멘트가 붙은 GitHub 묶음은 묶음째 펼쳐 두지 않고 안에서 다시 접는다(PowerShell-Docs#13281: 170블록 묶음이 통째로 펼쳐지던 것)
  for (const group of body.children) if (isPinnedGroup(group)) made += foldChildren(group as HTMLElement);
  return made;
}

function foldChildren(container: HTMLElement): number {
  const doc = container.ownerDocument;
  const kids = [...container.children];
  let made = 0;
  let i = 0;
  while (i < kids.length) {
    if (!foldableIn(kids[i]) || isAnchor(kids[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < kids.length && foldableIn(kids[j])) j++;
    const run = kids.slice(i, j);
    i = j;
    if (run[0].previousElementSibling?.getAttribute(MDF_ATTR) === BAR) continue;
    const blocks = countBlocks(run);
    if (blocks === 0) {
      for (const el of run) setHidden(el, true);
      continue;
    }
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

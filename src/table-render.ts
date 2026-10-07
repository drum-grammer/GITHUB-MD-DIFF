import { t } from './i18n';
import { MDF_ATTR, setHidden, type TablePair } from './selectors';
import { diffRows, normalizeCell, type Row, type RowOp } from './table-diff';

export const MAX_ROWS = 2000;
const WRAP = 'table';
const ROW_FOLD = 'fold-rows';

/** 합친 표의 행 → 그 행을 복사해 온 GitHub 원래 표의 행(코멘트가 가리킬 원문 줄을 찾을 때 쓴다) */
const origins = new WeakMap<Element, HTMLTableRowElement>();
/** GitHub 원래 표의 행 → 합친 표에서 그 행을 보여 주는 행(바뀐 행은 옛 행도 같은 행으로) */
const copies = new WeakMap<Element, HTMLTableRowElement>();

function cloneRow(row: HTMLTableRowElement): HTMLTableRowElement {
  const tr = row.cloneNode(true) as HTMLTableRowElement;
  origins.set(tr, row);
  copies.set(row, tr);
  return tr;
}

export function originRow(tr: Element): HTMLTableRowElement | null {
  return origins.get(tr) ?? null;
}

export function mergedRow(original: Element): HTMLTableRowElement | null {
  const tr = copies.get(original);
  return tr?.isConnected ? tr : null;
}

interface TableParts {
  header: HTMLTableRowElement;
  rows: HTMLTableRowElement[];
}

/** 머리 행과 본문 행. thead가 없으면 첫 행을 머리로 본다 */
function parts(table: HTMLTableElement): TableParts | null {
  const all = [...table.rows];
  const thead = table.tHead;
  if (thead && thead.rows.length > 0) {
    return { header: thead.rows[0], rows: all.filter((r) => r.parentElement !== thead) };
  }
  if (all.length === 0) return null;
  return { header: all[0], rows: all.slice(1) };
}

const cellsOf = (row: HTMLTableRowElement): Row => [...row.cells].map((c) => normalizeCell(c.textContent ?? ''));
const hasSpan = (table: HTMLTableElement): boolean => table.querySelector('[colspan], [rowspan]') !== null;

function actionButton(doc: Document, label: string, action: string): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'mdf-btn';
  b.textContent = label;
  b.setAttribute('data-mdf-action', action);
  b.setAttribute('aria-pressed', 'false');
  return b;
}

/** 접기 행 버튼 바로 뒤의 같은 행들을 펼치거나 접는다 */
export function setRowFoldExpanded(btn: HTMLElement, expanded: boolean): void {
  let row = btn.closest('tr')?.nextElementSibling ?? null;
  while (row && row.classList.contains('mdf-row-same')) {
    setHidden(row, !expanded);
    row = row.nextElementSibling;
  }
  btn.setAttribute('aria-expanded', String(expanded));
  const arrow = btn.querySelector('.mdf-arrow');
  if (arrow) arrow.textContent = expanded ? '▾' : '▸';
}

function foldRow(doc: Document, count: number, colCount: number): HTMLTableRowElement {
  const tr = doc.createElement('tr');
  tr.className = 'mdf-fold-row';
  const td = doc.createElement('td');
  td.colSpan = colCount;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'mdf-fold';
  btn.setAttribute(MDF_ATTR, ROW_FOLD);
  const arrow = doc.createElement('span');
  arrow.className = 'mdf-arrow';
  arrow.textContent = '▸';
  const text = doc.createElement('span');
  text.textContent = count === 1 ? t('foldRowOne') : t('foldRows', [count]);
  btn.append(arrow, text);
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => setRowFoldExpanded(btn, btn.getAttribute('aria-expanded') !== 'true'));
  td.append(btn);
  tr.append(td);
  return tr;
}

function renderOp(
  doc: Document,
  op: Exclude<RowOp, { kind: 'same' }>,
  oldRows: HTMLTableRowElement[],
  newRows: HTMLTableRowElement[],
): HTMLTableRowElement {
  if (op.kind === 'added') {
    const tr = cloneRow(newRows[op.newIndex]);
    tr.classList.add('mdf-row-added');
    return tr;
  }
  if (op.kind === 'removed') {
    const tr = cloneRow(oldRows[op.oldIndex]);
    tr.classList.add('mdf-row-removed');
    return tr;
  }
  const tr = cloneRow(newRows[op.newIndex]);
  copies.set(oldRows[op.oldIndex], tr);
  tr.classList.add('mdf-row-changed');
  const oldCells = oldRows[op.oldIndex].cells;
  for (const c of op.changedCells) {
    const cell = tr.cells[c];
    if (!cell) continue; // 새 행에 없는 칸 — 머리 행이 같으면 드물다
    const before = doc.createElement('span');
    before.className = 'mdf-cell-old';
    const oldCell = oldCells[c];
    if (oldCell) before.append(...[...oldCell.childNodes].map((nd) => nd.cloneNode(true)));
    const after = doc.createElement('span');
    after.className = 'mdf-cell-new';
    after.append(...[...cell.childNodes]);
    cell.append(before, doc.createTextNode(' '), after);
  }
  return tr;
}

/** 옛 표·새 표 쌍을 바뀐 행만 보이는 표 하나로 합친다. 합칠 수 없거나 이미 합쳤으면 null(원래 화면 그대로) */
export function mergeTablePair(pair: TablePair): HTMLElement | null {
  const { del, ins, oldTable, newTable } = pair;
  if (del.previousElementSibling?.getAttribute(MDF_ATTR) === WRAP) return null;
  if (hasSpan(oldTable) || hasSpan(newTable)) return null;
  const o = parts(oldTable);
  const n = parts(newTable);
  if (!o || !n) return null;
  if (o.rows.length > MAX_ROWS || n.rows.length > MAX_ROWS) return null;
  if (cellsOf(o.header).join('\u0001') !== cellsOf(n.header).join('\u0001')) return null;
  const ops = diffRows(o.rows.map(cellsOf), n.rows.map(cellsOf));
  if (ops.every((op) => op.kind === 'same')) return null;

  const doc = del.ownerDocument;
  const table = doc.createElement('table');
  const thead = doc.createElement('thead');
  thead.append(cloneRow(n.header));
  const tbody = doc.createElement('tbody');
  const colCount = Math.max(n.header.cells.length, 1);
  let sameRun: HTMLTableRowElement[] = [];
  const flushSame = () => {
    if (sameRun.length === 0) return;
    tbody.append(foldRow(doc, sameRun.length, colCount), ...sameRun);
    sameRun = [];
  };
  for (const op of ops) {
    if (op.kind === 'same') {
      const tr = cloneRow(n.rows[op.newIndex]);
      tr.classList.add('mdf-row-same');
      setHidden(tr, true);
      sameRun.push(tr);
      continue;
    }
    flushSame();
    tbody.append(renderOp(doc, op, o.rows, n.rows));
  }
  flushSame();
  table.append(thead, tbody);

  const wrap = doc.createElement('div');
  wrap.className = 'mdf-table';
  wrap.setAttribute(MDF_ATTR, WRAP);
  const toolbar = doc.createElement('div');
  toolbar.className = 'mdf-toolbar';
  const allBtn = actionButton(doc, t('tableAllRows'), 'all-rows');
  const origBtn = actionButton(doc, t('tableOriginal'), 'original');
  allBtn.addEventListener('click', () => setTableAllRows(wrap, allBtn.getAttribute('aria-pressed') !== 'true'));
  origBtn.addEventListener('click', () => setTableOriginal(wrap, origBtn.getAttribute('aria-pressed') !== 'true'));
  toolbar.append(allBtn, origBtn);
  wrap.append(toolbar, table);

  del.before(wrap);
  setHidden(del, true);
  setHidden(ins, true);
  return wrap;
}

/** 합친 표의 같은 행을 모두 펼치거나(강조 유지) 바뀐 행만으로 되돌린다 */
export function setTableAllRows(wrap: HTMLElement, all: boolean): void {
  for (const btn of wrap.querySelectorAll<HTMLElement>(`[${MDF_ATTR}="${ROW_FOLD}"]`)) setRowFoldExpanded(btn, all);
  const b = wrap.querySelector<HTMLElement>('[data-mdf-action="all-rows"]');
  if (b) {
    b.setAttribute('aria-pressed', String(all));
    b.textContent = all ? t('tableChangedRows') : t('tableAllRows');
  }
}

/** GitHub 원래의 옛 표·새 표와 합친 표를 오간다 */
export function setTableOriginal(wrap: HTMLElement, original: boolean): void {
  const table = wrap.querySelector('table');
  if (table) setHidden(table, original);
  const del = wrap.nextElementSibling;
  const ins = del?.nextElementSibling;
  if (del) setHidden(del, !original);
  if (ins) setHidden(ins, !original);
  const all = wrap.querySelector<HTMLElement>('[data-mdf-action="all-rows"]');
  if (all) all.hidden = original;
  const b = wrap.querySelector<HTMLElement>('[data-mdf-action="original"]');
  if (b) {
    b.setAttribute('aria-pressed', String(original));
    b.textContent = original ? t('tableMerged') : t('tableOriginal');
  }
}

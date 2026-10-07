import { addFileToolbar } from './controls';
import { foldUnchanged } from './fold';
import { HIDDEN_CLASS, MDF_ATTR, PIN_ATTR, UNCOLLAPSED_ATTR, setHidden, tablePairs } from './selectors';
import { mergeTablePair } from './table-render';

export interface ApplyResult {
  folds: number;
  tables: number;
  errors: unknown[];
}

/** 렌더링 diff 본문 하나에 표 합치기·접기·파일 버튼을 적용한다. 여러 번 불러도 결과가 같다 */
export function applyBody(body: HTMLElement): ApplyResult {
  const result: ApplyResult = { folds: 0, tables: 0, errors: [] };
  for (const pair of tablePairs(body)) {
    try {
      if (mergeTablePair(pair)) result.tables++;
    } catch (e) {
      result.errors.push(e);
    }
  }
  try {
    result.folds = foldUnchanged(body);
  } catch (e) {
    result.errors.push(e);
  }
  try {
    addFileToolbar(body);
  } catch (e) {
    result.errors.push(e);
  }
  return result;
}

/** 확장이 만든 것을 모두 걷어내 원래 화면으로 돌린다(렌더링/원문 선택은 그대로) */
export function undoAll(root: ParentNode): void {
  for (const el of root.querySelectorAll(`[${MDF_ATTR}]`)) el.remove();
  for (const el of root.querySelectorAll(`.${HIDDEN_CLASS}`)) setHidden(el, false);
  for (const el of root.querySelectorAll(`[${UNCOLLAPSED_ATTR}]`)) {
    el.classList.add('collapsed');
    el.removeAttribute(UNCOLLAPSED_ATTR);
  }
  for (const el of root.querySelectorAll(`[${PIN_ATTR}]`)) el.removeAttribute(PIN_ATTR);
  for (const el of root.querySelectorAll('.mdf-selected')) el.classList.remove('mdf-selected');
}

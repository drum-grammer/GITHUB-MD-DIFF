import { fileOf, hasReviewThreads, isCollapsed, isPressed, proseBody, viewButton } from './selectors';

export const RICH_TIMEOUT_MS = 5000;
/** 눌렀는데 눌림이 반영되지 않으면(GitHub가 아직 클릭을 받을 준비 전) 다시 누르는 간격과 최대 횟수 */
export const RECLICK_MS = 1000;
export const MAX_CLICKS = 3;

interface ClickRecord {
  first: number;
  last: number;
  count: number;
}

export interface AutoRichState {
  /** 파일 키 → 확장이 렌더링 버튼을 누른 기록 */
  clicks: Map<string, ClickRecord>;
  /** 사람이 원문 보기를 고른 파일 키 */
  userSource: Set<string>;
  /** 파일 키 → 렌더링 버튼을 처음 못 찾은 시각(그리는 중일 수 있어 바로 실패로 치지 않는다) */
  missingSince: Map<string, number>;
}

export function createAutoRichState(): AutoRichState {
  return { clicks: new Map(), userSource: new Set(), missingSince: new Map() };
}

export type RichStatus =
  | 'rich' // 렌더링 본문이 있다
  | 'clicked' // 방금 렌더링 버튼을 눌렀다(다시 누른 경우 포함)
  | 'waiting' // 누른 뒤 렌더링을 기다린다
  | 'timeout' // 눌렀는데 시간 안에 렌더링이 안 나왔다
  | 'pending' // 버튼이 아직 안 그려졌다
  | 'no-button' // 시간이 지나도 버튼이 없다
  | 'idle' // 할 일 없음: 접힌 파일, 또는 렌더링 보기가 이미 골라져 본문만 내려간 상태
  | 'user-source' // 사람이 원문 보기를 골랐다
  | 'has-threads'; // 줄 코멘트가 있어 원문 그대로 둔다

/**
 * md 파일을 렌더링 보기로 맞춘다. 누른 뒤 렌더링이 나타날 때까지는 다시 누르지 않는다 —
 * 단 눌림이 반영되지 않았으면 1초 간격으로 최대 3번까지 다시 누른다.
 * 사람이 원문을 고른 파일, 접힌 파일, 줄 코멘트가 있는 파일은 건드리지 않는다.
 */
export function ensureRich(file: HTMLElement, key: string, state: AutoRichState, now: number): RichStatus {
  if (proseBody(file)) {
    state.clicks.delete(key); // 나중에 GitHub가 원문으로 다시 그리면 한 번 더 누를 수 있게
    state.missingSince.delete(key);
    return 'rich';
  }
  if (state.userSource.has(key)) return 'user-source';
  if (isCollapsed(file)) {
    state.clicks.delete(key);
    return 'idle';
  }
  const button = viewButton(file, 'rich');
  const rec = state.clicks.get(key);
  if (rec) {
    if (now - rec.first > RICH_TIMEOUT_MS) return 'timeout';
    const lost = button && !isPressed(button);
    if (lost && rec.count < MAX_CLICKS && now - rec.last >= RECLICK_MS) {
      button.click();
      rec.last = now;
      rec.count++;
      return 'clicked';
    }
    return 'waiting';
  }
  if (!button) {
    const since = state.missingSince.get(key) ?? now;
    state.missingSince.set(key, since);
    return now - since > RICH_TIMEOUT_MS ? 'no-button' : 'pending';
  }
  state.missingSince.delete(key);
  if (isPressed(button)) return 'idle';
  if (hasReviewThreads(file)) return 'has-threads';
  button.click();
  state.clicks.set(key, { first: now, last: now, count: 1 });
  return 'clicked';
}

/** 원문/렌더링 버튼 클릭을 지켜 사람이 고른 보기를 기억한다. 끝내는 함수를 돌려준다 */
export function watchUserViewClicks(
  doc: Document,
  state: AutoRichState,
  keyOf: (file: HTMLElement) => string,
): () => void {
  const onClick = (e: Event) => {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    const file = btn ? fileOf(btn) : null;
    if (!btn || !file) return;
    // 확장은 렌더링 버튼만 누르므로, 원문 클릭은 언제나 사람 것이다
    if (viewButton(file, 'source') === btn) state.userSource.add(keyOf(file));
    else if (viewButton(file, 'rich') === btn) state.userSource.delete(keyOf(file));
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}

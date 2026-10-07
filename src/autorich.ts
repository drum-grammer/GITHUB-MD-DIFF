import {
  fileOf, hasReviewThreads, hasUnknownRendering, isCollapsed, isLoadingPlaceholder, isPressed, proseBody, showsDiffNotice, viewButton,
} from './selectors';

export const RICH_TIMEOUT_MS = 5000;
/**
 * 누른 뒤 이만큼 지나도 렌더링이 없고 상자가 비어 있으면 GitHub가 그 파일의 렌더링을 못 만든 것으로 보고
 * 원문 보기로 되돌린다 — 그대로 두면 빈 상자만 남아 원문도 못 읽는다. GitHub의 시간 초과(504)는 10초 안팎이다
 */
export const FALLBACK_MS = 15000;
/** 렌더링을 기다리는 파일은 이만큼까지만 — md 파일이 수백 개인 PR에서 GitHub에 렌더링 요청을 한꺼번에 보내지 않는다 */
export const MAX_IN_FLIGHT = 6;
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
  /** 줄 코멘트가 있는데 렌더링으로 바꾼 파일 키 — 렌더링 보기에 스레드를 못 보여 주면 원문 보기 안내를 띄운다 */
  hadThreads: Set<string>;
  /** GitHub가 렌더링을 못 만들어 확장이 원문 보기로 되돌린 파일 키 — 다시 누르지 않는다 */
  fellBack: Set<string>;
  /** 확장이 버튼을 누르는 중 — 그 클릭을 사람의 선택으로 기억하지 않는다 */
  selfClick: boolean;
}

export function createAutoRichState(): AutoRichState {
  return { clicks: new Map(), userSource: new Set(), missingSince: new Map(), hadThreads: new Set(), fellBack: new Set(), selfClick: false };
}

/** 누르고 렌더링을 기다리는 파일 수(되돌릴 때가 지난 것은 세지 않는다) */
function inFlight(state: AutoRichState, now: number): number {
  let n = 0;
  for (const rec of state.clicks.values()) if (now - rec.first <= FALLBACK_MS) n++;
  return n;
}

/** 확장이 누르는 클릭 */
function press(state: AutoRichState, button: HTMLElement): void {
  state.selfClick = true;
  try {
    button.click();
  } finally {
    state.selfClick = false;
  }
}

export type RichStatus =
  | 'rich' // 렌더링 본문이 있다
  | 'clicked' // 방금 렌더링 버튼을 눌렀다(다시 누른 경우 포함)
  | 'waiting' // 누른 뒤 렌더링을 기다린다
  | 'queued' // 렌더링을 기다리는 파일이 많아 차례를 기다린다
  | 'timeout' // 눌렀는데 렌더링이 확장이 모르는 모양으로 나왔다(GitHub 화면 변경)
  | 'fallback' // GitHub가 렌더링을 못 만들어(빈 상자) 원문 보기로 되돌렸다
  | 'pending' // 버튼이 아직 안 그려졌다
  | 'lazy' // GitHub가 파일 내용을 아직 안 채웠다(뼈대) — 스크롤해 오면 채운다
  | 'notice' // 원문 보기가 줄 대신 안내 글이다(이름만 바뀜·큰 diff의 Load Diff) — 렌더링할 것이 없다
  | 'no-button' // 시간이 지나도 버튼이 없다
  | 'idle' // 할 일 없음: 접힌 파일, 또는 렌더링 보기가 이미 골라져 본문만 내려간 상태
  | 'user-source' // 사람이 원문 보기를 골랐다
  | 'has-threads'; // 줄 코멘트가 있어 원문 그대로 둔다(로그아웃 — 렌더링 보기에 스레드를 보여 줄 수 없다)

/**
 * md 파일을 렌더링 보기로 맞춘다. 누른 뒤 렌더링이 나타날 때까지는 다시 누르지 않는다 —
 * 단 눌림이 반영되지 않았으면 1초 간격으로 최대 3번까지 다시 누른다.
 * 사람이 원문을 고른 파일, 접힌 파일은 건드리지 않는다. 줄 코멘트가 있는 파일은 렌더링 보기에 스레드를 보여 줄 수 있을 때
 * (`threadsInRich`, 로그인)만 바꾼다.
 */
export function ensureRich(file: HTMLElement, key: string, state: AutoRichState, now: number, threadsInRich = false): RichStatus {
  if (proseBody(file)) {
    state.clicks.delete(key); // 나중에 GitHub가 원문으로 다시 그리면 한 번 더 누를 수 있게
    state.missingSince.delete(key);
    return 'rich';
  }
  if (state.userSource.has(key)) return 'user-source';
  if (state.fellBack.has(key)) return 'fallback';
  if (isCollapsed(file)) {
    state.clicks.delete(key);
    return 'idle';
  }
  const button = viewButton(file, 'rich');
  const rec = state.clicks.get(key);
  if (rec) {
    const waited = now - rec.first;
    if (waited > RICH_TIMEOUT_MS && hasUnknownRendering(file)) return 'timeout';
    if (waited > FALLBACK_MS) {
      state.clicks.delete(key);
      state.fellBack.add(key);
      const source = viewButton(file, 'source');
      if (source && !isPressed(source)) press(state, source);
      return 'fallback';
    }
    const lost = button && !isPressed(button);
    if (lost && rec.count < MAX_CLICKS && now - rec.last >= RECLICK_MS) {
      press(state, button);
      rec.last = now;
      rec.count++;
      return 'clicked';
    }
    return 'waiting';
  }
  if (!button && isLoadingPlaceholder(file)) {
    state.missingSince.delete(key);
    return 'lazy';
  }
  if (!button) {
    const since = state.missingSince.get(key) ?? now;
    state.missingSince.set(key, since);
    return now - since > RICH_TIMEOUT_MS ? 'no-button' : 'pending';
  }
  state.missingSince.delete(key);
  if (isPressed(button)) return 'idle';
  if (showsDiffNotice(file)) return 'notice';
  const threads = hasReviewThreads(file);
  if (threads && !threadsInRich) return 'has-threads';
  if (inFlight(state, now) >= MAX_IN_FLIGHT) return 'queued';
  if (threads) state.hadThreads.add(key);
  press(state, button);
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
    if (state.selfClick) return;
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    const file = btn ? fileOf(btn) : null;
    if (!btn || !file) return;
    const key = keyOf(file);
    if (viewButton(file, 'source') === btn) state.userSource.add(key);
    else if (viewButton(file, 'rich') === btn) {
      // 사람이 고른 렌더링 — 늦게 나와도 되돌리지 않는다
      state.userSource.delete(key);
      state.fellBack.delete(key);
      state.clicks.delete(key);
    }
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}

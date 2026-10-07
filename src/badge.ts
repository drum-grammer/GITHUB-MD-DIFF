export interface BadgeState {
  text: string;
  color: string;
  icon: 'on' | 'off';
  titleKey: string;
  titleSubs: string[];
}

const GREEN = '#1f883d';
const RED = '#d1242f';

/** 툴바 아이콘 — 켜짐은 컬러, 꺼짐은 회색 */
export const ICON_PATHS = {
  on: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' },
  off: { 16: 'icons/icon16-off.png', 32: 'icons/icon32-off.png' },
} as const;

/**
 * 툴바 상태 — 켜짐·꺼짐은 아이콘 색으로만 보여 주고(글자 배지가 16px 아이콘을 가린다),
 * 배지는 켜져 있는데 화면을 못 읽었을 때 "!"만 띄운다
 */
export function badgeFor(enabled: boolean, problems: string[]): BadgeState {
  if (!enabled) return { text: '', color: GREEN, icon: 'off', titleKey: 'titleOff', titleSubs: [] };
  if (problems.length > 0) return { text: '!', color: RED, icon: 'on', titleKey: 'titleProblem', titleSubs: [problems.join(', ')] };
  return { text: '', color: GREEN, icon: 'on', titleKey: 'titleOn', titleSubs: [] };
}

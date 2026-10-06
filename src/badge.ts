export interface BadgeState {
  text: string;
  color: string;
  titleKey: string;
  titleSubs: string[];
}

const GREEN = '#1f883d';
const RED = '#d1242f';

/** 아이콘 배지 — 켜짐 ON · 꺼짐 빈칸 · 켜져 있는데 화면을 못 읽었으면 ! */
export function badgeFor(enabled: boolean, problems: string[]): BadgeState {
  if (!enabled) return { text: '', color: GREEN, titleKey: 'titleOff', titleSubs: [] };
  if (problems.length > 0) return { text: '!', color: RED, titleKey: 'titleProblem', titleSubs: [problems.join(', ')] };
  return { text: 'ON', color: GREEN, titleKey: 'titleOn', titleSubs: [] };
}

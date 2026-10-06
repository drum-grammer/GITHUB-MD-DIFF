import { describe, expect, it } from 'vitest';
import { badgeFor } from '../src/badge';

describe('badgeFor', () => {
  it('켜짐', () => {
    expect(badgeFor(true, [])).toEqual({ text: 'ON', color: '#1f883d', titleKey: 'titleOn', titleSubs: [] });
  });
  it('꺼짐이면 문제가 있어도 빈칸', () => {
    expect(badgeFor(false, ['x'])).toEqual({ text: '', color: '#1f883d', titleKey: 'titleOff', titleSubs: [] });
  });
  it('켜져 있고 인식 실패가 있으면 ! 와 이유', () => {
    expect(badgeFor(true, ['가', '나'])).toEqual({ text: '!', color: '#d1242f', titleKey: 'titleProblem', titleSubs: ['가, 나'] });
  });
});

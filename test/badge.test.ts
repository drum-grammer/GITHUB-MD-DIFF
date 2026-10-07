import { describe, expect, it } from 'vitest';
import { ICON_PATHS, badgeFor } from '../src/badge';

describe('badgeFor', () => {
  it('켜짐: 배지 글자 없이 컬러 아이콘 — 아이콘을 가리지 않는다', () => {
    expect(badgeFor(true, [])).toEqual({ text: '', color: '#1f883d', icon: 'on', titleKey: 'titleOn', titleSubs: [] });
  });
  it('꺼짐: 배지 없이 회색 아이콘(문제가 있어도)', () => {
    expect(badgeFor(false, ['x'])).toEqual({ text: '', color: '#1f883d', icon: 'off', titleKey: 'titleOff', titleSubs: [] });
  });
  it('켜져 있고 인식 실패가 있으면 ! 와 이유', () => {
    expect(badgeFor(true, ['가', '나'])).toEqual({ text: '!', color: '#d1242f', icon: 'on', titleKey: 'titleProblem', titleSubs: ['가, 나'] });
  });
});

describe('ICON_PATHS', () => {
  it('켜짐은 컬러, 꺼짐은 회색 툴바 아이콘(16·32)', () => {
    expect(ICON_PATHS.on).toEqual({ 16: 'icons/icon16.png', 32: 'icons/icon32.png' });
    expect(ICON_PATHS.off).toEqual({ 16: 'icons/icon16-off.png', 32: 'icons/icon32-off.png' });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (...args: unknown[]) => unknown;

/** background가 쓰는 chrome API만 흉내 내고 부른 순서를 기록한다 */
function installFakeChrome(tabIds: number[], stored: Record<string, unknown>) {
  const listeners: Record<string, Listener> = {};
  const calls: Array<[string, Record<string, unknown>]> = [];
  const on = (name: string) => ({ addListener: (f: Listener) => { listeners[name] = f; } });
  const record = (kind: string) => async (d: Record<string, unknown>) => { calls.push([kind, d]); };
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (defaults: Record<string, unknown>) => ({ ...defaults, ...stored }),
        set: async (v: Record<string, unknown>) => { Object.assign(stored, v); calls.push(['set', v]); },
      },
    },
    i18n: { getMessage: (k: string) => k },
    action: {
      setIcon: record('icon'),
      setBadgeText: record('text'),
      setBadgeBackgroundColor: record('color'),
      setTitle: record('title'),
      onClicked: on('clicked'),
    },
    runtime: { onInstalled: on('installed'), onStartup: on('startup'), onMessage: on('message') },
    tabs: { query: async () => tabIds.map((id) => ({ id })) },
  };
  return { listeners, calls };
}

describe('background — 아이콘으로 켜고 끄기', () => {
  beforeEach(() => vi.resetModules());

  it('끄면 전역 배지와 모든 탭 배지를 빈칸으로 칠한 뒤 저장한다', async () => {
    const stored: Record<string, unknown> = { enabled: true };
    const { listeners, calls } = installFakeChrome([7, 9], stored);
    await import('../src/background');
    await listeners.clicked();
    expect(stored.enabled).toBe(false);
    const texts = calls.filter(([k]) => k === 'text').map(([, d]) => d);
    expect(texts).toContainEqual({ text: '' });
    expect(texts).toContainEqual({ tabId: 7, text: '' });
    expect(texts).toContainEqual({ tabId: 9, text: '' });
    const icons = calls.filter(([k]) => k === 'icon').map(([, d]) => d);
    const off = { 16: 'icons/icon16-off.png', 32: 'icons/icon32-off.png' };
    expect(icons).toContainEqual({ path: off });
    expect(icons).toContainEqual({ tabId: 7, path: off });
    // 탭을 다 칠한 뒤에 저장해야, 저장 알림을 받은 페이지가 다시 보낸 ! 를 덮어쓰지 않는다
    const lastTabPaint = calls.map(([k, d]) => k === 'text' && d.tabId !== undefined).lastIndexOf(true);
    expect(calls.findIndex(([k]) => k === 'set')).toBeGreaterThan(lastTabPaint);
  });

  it('켜면 모든 탭을 컬러 아이콘·빈 배지로', async () => {
    const stored: Record<string, unknown> = { enabled: false };
    const { listeners, calls } = installFakeChrome([3], stored);
    await import('../src/background');
    await listeners.clicked();
    expect(stored.enabled).toBe(true);
    expect(calls.filter(([k]) => k === 'text').map(([, d]) => d)).toContainEqual({ tabId: 3, text: '' });
    expect(calls.filter(([k]) => k === 'icon').map(([, d]) => d)).toContainEqual({
      tabId: 3,
      path: { 16: 'icons/icon16.png', 32: 'icons/icon32.png' },
    });
  });
});

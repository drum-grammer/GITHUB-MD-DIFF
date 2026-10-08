// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldReload } from '../src/dev/reload-policy';

describe('shouldReload', () => {
  it('디스크 빌드가 없거나 같으면 하지 않는다', () => {
    expect(shouldReload('a', null, undefined)).toBe(false);
    expect(shouldReload('a', 'a', undefined)).toBe(false);
  });
  it('다르면 한다', () => expect(shouldReload('a', 'b', undefined)).toBe(true));
  it('같은 쌍(a → b)으로 이미 다시 로드했는데 그대로면 시간이 지나도 하지 않는다', () => {
    expect(shouldReload('a', 'b', { build: 'b', from: 'a', at: 0 })).toBe(false);
  });
  it('새 빌드가 나오면 다시 한다', () => {
    expect(shouldReload('a', 'c', { build: 'b', from: 'a', at: 0 })).toBe(true);
    expect(shouldReload('b', 'c', { build: 'c', from: 'a', at: 0 })).toBe(true);
  });
});

type Listener = (...args: unknown[]) => unknown;

/** 개발 background가 쓰는 chrome API(스토어 background가 등록하는 것 포함)와 dev-build.json fetch를 흉내 낸다 */
function installFakeChrome(stored: Record<string, unknown>, disk: unknown) {
  const listeners: Record<string, Listener> = {};
  const on = (name: string) => ({ addListener: (f: Listener) => { listeners[name] = f; } });
  const reload = vi.fn();
  const tabReload = vi.fn(async () => undefined);
  const noop = async () => undefined;
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: async (k: string | Record<string, unknown>) =>
          typeof k === 'string' ? (k in stored ? { [k]: stored[k] } : {}) : { ...k, ...stored },
        set: async (v: Record<string, unknown>) => { Object.assign(stored, v); },
        remove: async (k: string) => { delete stored[k]; },
      },
    },
    i18n: { getMessage: (k: string) => k },
    action: { setIcon: noop, setBadgeText: noop, setBadgeBackgroundColor: noop, setTitle: noop, onClicked: on('clicked') },
    runtime: {
      onInstalled: on('installed'),
      onStartup: on('startup'),
      onMessage: on('message'),
      getURL: (p: string) => `chrome-extension://dev/${p}`,
      reload,
    },
    tabs: { query: async () => [], reload: tabReload },
  };
  globalThis.fetch = vi.fn(async () => {
    if (disk === undefined) throw new Error('파일 없음');
    return new Response(typeof disk === 'string' ? disk : JSON.stringify(disk));
  }) as typeof fetch;
  return { listeners, reload, tabReload };
}

describe('개발 background — 자기 갱신', () => {
  beforeEach(() => vi.resetModules());

  it('도는 빌드와 디스크 빌드가 다르면 탭을 기억하고 확장을 다시 로드한다', async () => {
    const stored: Record<string, unknown> = {};
    const { reload } = installFakeChrome(stored, { build: 'new' });
    const { onDevBuild } = await import('../src/dev/background');
    expect(await onDevBuild('old', 7, 5000)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(stored['dev.reloadTab']).toBe(7);
    expect(stored['dev.lastReload']).toEqual({ build: 'new', from: 'old', at: 5000 });
  });

  it('같으면 아무것도 하지 않는다', async () => {
    const { reload } = installFakeChrome({}, { build: 'same' });
    const { onDevBuild } = await import('../src/dev/background');
    expect(await onDevBuild('same', 7)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('dev-build.json을 못 읽거나 모양이 틀리면 다시 로드하지 않는다', async () => {
    for (const disk of [undefined, {}, 'not json']) {
      vi.resetModules();
      const { reload } = installFakeChrome({}, disk);
      const { onDevBuild } = await import('../src/dev/background');
      expect(await onDevBuild('old', 7)).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    }
  });

  it('다시 뜬 background는 기억한 탭을 새로고침하고 잊는다', async () => {
    const stored: Record<string, unknown> = { 'dev.reloadTab': 7 };
    const { tabReload } = installFakeChrome(stored, { build: 'new' });
    await import('../src/dev/background');
    await vi.waitFor(() => expect(tabReload).toHaveBeenCalledWith(7));
    expect(stored['dev.reloadTab']).toBeUndefined();
  });

  it('같은 쌍으로 이미 다시 로드했으면 또 하지 않는다(루프 방지)', async () => {
    const { reload } = installFakeChrome({ 'dev.lastReload': { build: 'new', from: 'old', at: 0 } }, { build: 'new' });
    const { onDevBuild } = await import('../src/dev/background');
    expect(await onDevBuild('old', 7, 10 * 60 * 1000)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('content가 보낸 dev-build 메시지로 갱신을 시작한다', async () => {
    const { listeners, reload } = installFakeChrome({}, { build: 'new' });
    await import('../src/dev/background');
    listeners.message({ type: 'dev-build', build: 'old' }, { tab: { id: 3 } });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });
});

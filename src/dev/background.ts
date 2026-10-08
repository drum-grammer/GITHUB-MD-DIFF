// 개발 빌드 background — 스토어 background에 자기 갱신을 더한다.
// content가 알린 빌드 번호가 디스크의 dev-build.json과 다르면 탭을 기억하고 확장을 다시 로드하고,
// 새로 뜬 background가 그 탭을 새로고침한다(압축해제 확장은 자기 파일을 디스크에서 바로 읽는다 — 2026-10-08 실험)
import '../background';
import { shouldReload, type LastReload } from './reload-policy';

const RELOAD_TAB = 'dev.reloadTab';
const LAST_RELOAD = 'dev.lastReload';

/** pnpm dev:chrome이 맨 마지막에 쓰는 파일의 빌드 번호. 못 읽거나 모양이 틀리면 null */
async function diskBuild(): Promise<string | null> {
  try {
    const res = await fetch(chrome.runtime.getURL('dev-build.json'), { cache: 'no-store' });
    const body = (await res.json()) as { build?: unknown };
    return typeof body.build === 'string' ? body.build : null;
  } catch {
    return null;
  }
}

/** 다시 로드했으면 true */
export async function onDevBuild(running: string, tabId: number, now = Date.now()): Promise<boolean> {
  const disk = await diskBuild();
  const last = (await chrome.storage.local.get(LAST_RELOAD))[LAST_RELOAD] as LastReload | undefined;
  if (!shouldReload(running, disk, last)) {
    if (disk !== null && disk !== running) console.warn(`[dev] ${running}에서 ${disk}로 다시 로드했는데 그대로다 — chrome://extensions에서 오류를 보고 ↻`);
    return false;
  }
  await chrome.storage.local.set({ [RELOAD_TAB]: tabId, [LAST_RELOAD]: { build: disk, from: running, at: now } });
  chrome.runtime.reload();
  return true;
}

/** 다시 로드한 뒤 처음 뜬 background — 기억한 탭을 새로고침해 새 content를 돌린다 */
export async function resumeAfterReload(): Promise<void> {
  const tabId = (await chrome.storage.local.get(RELOAD_TAB))[RELOAD_TAB];
  if (typeof tabId !== 'number') return;
  await chrome.storage.local.remove(RELOAD_TAB);
  await chrome.tabs.reload(tabId).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || typeof msg !== 'object' || msg === null) return;
  const m = msg as { type?: unknown; build?: unknown };
  if (m.type !== 'dev-build' || typeof m.build !== 'string') return;
  void onDevBuild(m.build, tabId);
});

void resumeAfterReload();

import { t } from './i18n';
import { ICON_PATHS, badgeFor } from './badge';

async function isEnabled(): Promise<boolean> {
  const { enabled } = await chrome.storage.local.get({ enabled: true });
  return enabled !== false;
}

/** tabId가 없으면 전체 배지, 있으면 그 탭 배지 */
async function paint(enabled: boolean, problems: string[], tabId?: number): Promise<void> {
  const b = badgeFor(enabled, problems);
  const title = t(b.titleKey, b.titleSubs);
  const target = tabId === undefined ? {} : { tabId };
  await chrome.action.setIcon({ ...target, path: ICON_PATHS[b.icon] });
  await chrome.action.setBadgeBackgroundColor({ ...target, color: b.color });
  await chrome.action.setBadgeText({ ...target, text: b.text });
  await chrome.action.setTitle({ ...target, title });
}

async function paintGlobal(): Promise<void> {
  await paint(await isEnabled(), []);
}

chrome.runtime.onInstalled.addListener(() => void paintGlobal());
chrome.runtime.onStartup.addListener(() => void paintGlobal());

/**
 * 켜고 끌 때 전역 배지와 모든 탭의 배지를 새 상태로 칠한 뒤 저장한다.
 * 탭별 배지는 탭이 다른 사이트로 가도 남으므로 함께 칠해야 하고, 저장을 나중에 해야
 * 저장 알림을 받은 GitHub 탭이 다시 보낸 ! 를 덮어쓰지 않는다.
 */
async function setEnabled(next: boolean): Promise<void> {
  await paint(next, []);
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((tab) => (tab.id === undefined ? undefined : paint(next, [], tab.id))));
  await chrome.storage.local.set({ enabled: next });
}

chrome.action.onClicked.addListener(async () => {
  await setEnabled(!(await isEnabled()));
});

// content script가 보내는 탭별 상태 { type: 'status', problems: string[] }
chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
  const tabId = sender.tab?.id;
  if (tabId === undefined || typeof msg !== 'object' || msg === null) return;
  const m = msg as { type?: unknown; problems?: unknown };
  if (m.type !== 'status' || !Array.isArray(m.problems)) return;
  const problems = m.problems.filter((p): p is string => typeof p === 'string');
  void isEnabled().then((on) => paint(on, problems, tabId));
});

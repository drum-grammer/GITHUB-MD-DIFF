import { badgeFor } from './badge';

async function isEnabled(): Promise<boolean> {
  const { enabled } = await chrome.storage.local.get({ enabled: true });
  return enabled !== false;
}

/** tabId가 없으면 전체 배지, 있으면 그 탭 배지 */
async function paint(enabled: boolean, problems: string[], tabId?: number): Promise<void> {
  const b = badgeFor(enabled, problems);
  const title = chrome.i18n.getMessage(b.titleKey, b.titleSubs) || 'GitHub MD Diff';
  const target = tabId === undefined ? {} : { tabId };
  await chrome.action.setBadgeBackgroundColor({ ...target, color: b.color });
  await chrome.action.setBadgeText({ ...target, text: b.text });
  await chrome.action.setTitle({ ...target, title });
}

async function paintGlobal(): Promise<void> {
  await paint(await isEnabled(), []);
}

chrome.runtime.onInstalled.addListener(() => void paintGlobal());
chrome.runtime.onStartup.addListener(() => void paintGlobal());

chrome.action.onClicked.addListener(async () => {
  await chrome.storage.local.set({ enabled: !(await isEnabled()) });
  await paintGlobal();
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

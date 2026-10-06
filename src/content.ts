import { applyBody, undoAll } from './apply';
import { createAutoRichState, ensureRich, watchUserViewClicks } from './autorich';
import { t } from './i18n';
import { fileKey, isPrChangesPage } from './page';
import { fileElements, filePath, isMarkdownPath, proseBody } from './selectors';

const LOG = '[github-md-diff]';
const state = createAutoRichState();
const problems = new Map<string, string>(); // 파일 키 → 문제 문구
const warned = new Set<string>();
let enabled = true;
let scheduled = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastReport = '';

const keyOf = (file: HTMLElement): string => fileKey(location.href, file.id);

function warnOnce(key: string, ...args: unknown[]): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(LOG, ...args);
}

/** 문제 목록이 바뀌었을 때(또는 force) 배지용 상태를 보낸다 */
function report(force = false): void {
  const list = [...new Set(problems.values())];
  const json = JSON.stringify(list);
  if (!force && json === lastReport) return;
  lastReport = json;
  chrome.runtime.sendMessage({ type: 'status', problems: list }).catch(() => {});
}

/** 파일 하나 처리. 렌더링을 기다리는 중이면 true */
function processFile(file: HTMLElement): boolean {
  const path = filePath(file);
  if (!path || !isMarkdownPath(path)) return false;
  const key = keyOf(file);
  const status = ensureRich(file, key, state, Date.now());
  if (status === 'no-button') problems.set(key, t('problemNoRichButton'));
  else if (status === 'timeout') problems.set(key, t('problemNoProseDiff'));
  else problems.delete(key);
  if (status === 'no-button' || status === 'timeout') warnOnce(`${key}:${status}`, path, problems.get(key));
  if (status === 'clicked' || status === 'waiting') return true;
  const body = status === 'rich' ? proseBody(file) : null;
  if (body) {
    const r = applyBody(body);
    if (r.errors.length) warnOnce(key, path, r.errors);
  }
  return false;
}

function scan(): void {
  scheduled = false;
  if (!enabled || !isPrChangesPage(location.href)) {
    if (problems.size) {
      problems.clear();
      report();
    }
    return;
  }
  const files = fileElements(document);
  const live = new Set(files.map(keyOf));
  for (const key of [...problems.keys()]) if (!live.has(key)) problems.delete(key); // 다른 PR로 옮겨 간 경우
  let waiting = false;
  for (const file of files) {
    try {
      waiting = processFile(file) || waiting;
    } catch (e) {
      warnOnce(keyOf(file), e);
    }
  }
  report();
  clearTimeout(retryTimer);
  if (waiting) retryTimer = setTimeout(schedule, 1000); // 화면 변화가 없어도 timeout을 판정하러 다시 본다
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(scan);
}

async function start(): Promise<void> {
  const stored = await chrome.storage.local.get({ enabled: true });
  enabled = stored.enabled !== false;
  watchUserViewClicks(document, state, keyOf);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('enabled' in changes)) return;
    enabled = changes.enabled.newValue !== false;
    if (!enabled) {
      undoAll(document);
      problems.clear();
    }
    report(true);
    schedule();
  });
  report(true);
  schedule();
}

void start();

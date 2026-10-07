import { applyBody, undoAll } from './apply';
import { createAutoRichState, ensureRich, watchUserViewClicks, type RichStatus } from './autorich';
import { attachComments, detachAllComments } from './comments';
import { t } from './i18n';
import { fileKey, isPrChangesPage } from './page';
import { problemsFor, type FileResult } from './problems';
import { fileElements, filePath, isMarkdownPath, isSignedIn, proseBody } from './selectors';

const LOG = '[github-md-diff]';
/** 이 상태의 파일이 있으면 화면 변화가 없어도 1초 뒤 다시 본다(시간 판정) */
const RETRY: ReadonlySet<RichStatus> = new Set<RichStatus>(['clicked', 'waiting', 'pending']);
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

/** md 파일 하나 처리 — 렌더링 보기로 맞추고, 렌더링이 있으면 접기·표 합치기를 적용한다. md가 아니면 null */
function processFile(file: HTMLElement): FileResult | null {
  const path = filePath(file);
  if (!path || !isMarkdownPath(path)) return null;
  const key = keyOf(file);
  const signedIn = isSignedIn(document);
  const status = ensureRich(file, key, state, Date.now(), signedIn);
  const body = status === 'rich' ? proseBody(file) : null;
  if (body) {
    const r = applyBody(body);
    if (r.errors.length) warnOnce(key, path, r.errors);
    if (signedIn) {
      try {
        attachComments(file, body, path, state.hadThreads.has(key));
      } catch (e) {
        warnOnce(`${key}:comments`, path, e);
      }
    }
  }
  return { key, status };
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
  const results: FileResult[] = [];
  for (const file of fileElements(document)) {
    try {
      const r = processFile(file);
      if (r) results.push(r);
    } catch (e) {
      warnOnce(keyOf(file), e);
    }
  }
  // 지금 화면의 파일로만 다시 만든다 — 다른 PR로 옮겨 가면 지난 문제는 사라진다
  problems.clear();
  for (const [key, problem] of problemsFor(results)) {
    problems.set(key, t(problem));
    warnOnce(`${key}:${problem}`, problem);
  }
  report();
  clearTimeout(retryTimer);
  if (results.some((r) => RETRY.has(r.status))) retryTimer = setTimeout(schedule, 1000);
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
      detachAllComments();
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

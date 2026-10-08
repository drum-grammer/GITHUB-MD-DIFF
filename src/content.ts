import { applyBody, noteNoVisibleChange, undoAll } from './apply';
import { createAutoRichState, ensureRich, watchUserViewClicks, type RichStatus } from './autorich';
import {
  attachComments,
  commentsBroken,
  commentsBrokenDetail,
  commentsReady,
  detachAllComments,
  onCommentHealthChange,
  prepareComments,
} from './comments';
import { t } from './i18n';
import { fileKey, isPrChangesPage } from './page';
import { problemsFor, type FileResult } from './problems';
import { browserOf, showProblemToast } from './report';
import { fileElements, filePath, isMarkdownPath, isSignedIn, pageVariant, proseBody, viewButton } from './selectors';

const LOG = '[github-md-diff]';
/** 이 상태의 파일이 있으면 화면 변화가 없어도 1초 뒤 다시 본다(시간 판정) */
const RETRY: ReadonlySet<RichStatus> = new Set<RichStatus>(['clicked', 'waiting', 'pending', 'queued']);
const state = createAutoRichState();
const problems = new Map<string, string>(); // 파일 키 → 문제 문구
const problemDetails = new Set<string>(); // 문제 보고용 진단(영어)
const warned = new Set<string>();
let enabled = true;
let scheduled = false;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastReport = '';

const keyOf = (file: HTMLElement): string => fileKey(location.href, file.id);

/**
 * 마지막으로 적용한 뒤 안이 바뀌지 않은 렌더링 본문 — 다시 적용하지 않는다. 렌더링을 기다리는 파일이 있으면 1초마다 훑으므로,
 * md 수백 개 PR에서 본문마다 접기·표 합치기를 다시 돌리지 않게 한다. 본문 안이 바뀌면(GitHub·확장 모두) 지운다
 */
let applied = new WeakSet<Element>();

function onMutations(records: MutationRecord[]): void {
  for (const r of records) {
    const el = r.target instanceof Element ? r.target : r.target.parentElement;
    const body = el?.closest('.markdown-body');
    if (body) applied.delete(body);
  }
  schedule();
}

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

/**
 * md 파일 하나 처리 — 렌더링 보기로 맞추고, 렌더링이 있으면 접기·표 합치기를 적용한다. md가 아니면 null.
 * `comments`(로그인했고 이 PR의 코멘트 요청이 정상)일 때만 코멘트를 붙이고, 스레드가 있는 파일도 렌더링으로 연다.
 */
function processFile(file: HTMLElement, comments: boolean): FileResult | null {
  const path = filePath(file);
  if (!path || !isMarkdownPath(path)) return null;
  const key = keyOf(file);
  const status = ensureRich(file, key, state, Date.now(), comments);
  const body = status === 'rich' ? proseBody(file) : null;
  if (body) {
    if (!applied.has(body)) {
      const r = applyBody(body);
      if (r.errors.length) warnOnce(key, path, r.errors);
      try {
        noteNoVisibleChange(body, () => viewButton(file, 'source')?.click());
      } catch (e) {
        warnOnce(`${key}:no-change`, path, e);
      }
      applied.add(body);
    }
    if (comments) {
      try {
        attachComments(file, body, path, state.hadThreads.has(key));
      } catch (e) {
        warnOnce(`${key}:comments`, path, e);
      }
    }
  }
  return { key, status };
}

/**
 * 화면 근처(위아래 한 화면 안)의 파일 — 렌더링 요청을 나눠 보내므로 보고 있는 곳이 먼저 바뀌게 한다.
 * 위치를 훑을 때마다 직접 읽으면 큰 PR에서 레이아웃을 매번 다시 계산해 화면이 멈춘다(md 334개 PR에서 0.6~1초) — 관찰자에게 맡긴다
 */
const nearView = new WeakSet<Element>();
const watchedFiles = new WeakSet<Element>();
const viewObserver =
  typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) nearView.add(e.target);
            else nearView.delete(e.target);
          }
        },
        { rootMargin: '100% 0px' },
      );

function byViewport(files: HTMLElement[]): HTMLElement[] {
  if (!viewObserver) return files;
  for (const f of files) {
    if (watchedFiles.has(f)) continue;
    watchedFiles.add(f);
    viewObserver.observe(f);
  }
  return [...files.filter((f) => nearView.has(f)), ...files.filter((f) => !nearView.has(f))];
}

function scan(): void {
  scheduled = false;
  if (!enabled || !isPrChangesPage(location.href)) {
    if (problems.size) {
      problems.clear();
      problemDetails.clear();
      report();
    }
    showProblemToast(document, null);
    return;
  }
  // 코멘트는 로그인했을 때만 — PR 데이터를 먼저 한 번 읽어 GitHub 요청이 그대로인지 본다
  const signedIn = isSignedIn(document);
  let comments = false;
  try {
    if (signedIn) prepareComments(location.href);
    comments = signedIn && commentsReady(location.href);
  } catch (e) {
    warnOnce('comments', e); // 코멘트 준비가 실패해도 접기·표 합치기는 그대로
  }
  const results: FileResult[] = [];
  for (const file of byViewport(fileElements(document))) {
    try {
      const r = processFile(file, comments);
      if (r) results.push(r);
    } catch (e) {
      warnOnce(keyOf(file), e);
    }
  }
  // 지금 화면의 파일로만 다시 만든다 — 다른 PR로 옮겨 가면 지난 문제는 사라진다
  problems.clear();
  problemDetails.clear();
  for (const [key, problem] of problemsFor(results)) {
    problems.set(key, t(problem));
    problemDetails.add(problem);
    warnOnce(`${key}:${problem}`, problem);
  }
  if (signedIn && results.length > 0 && commentsBroken(location.href)) {
    problems.set('comments', t('problemComments'));
    problemDetails.add(`problemComments — ${commentsBrokenDetail(location.href)}`);
  }
  report();
  // 툴바 "!"와 함께, 페이지 구석에 이유와 "GitHub에 알리기" 링크
  showProblemToast(
    document,
    problems.size
      ? {
          version: chrome.runtime.getManifest().version,
          reasons: [...new Set(problems.values())],
          details: [...problemDetails],
          page: pageVariant(document),
          browser: browserOf(navigator.userAgent),
          date: new Date().toISOString().slice(0, 10),
        }
      : null,
  );
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
  onCommentHealthChange(schedule); // PR 데이터를 읽고 나면 스레드가 있는 파일을 렌더링으로 열거나 "!"를 띄운다
  new MutationObserver(onMutations).observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('enabled' in changes)) return;
    enabled = changes.enabled.newValue !== false;
    if (!enabled) {
      detachAllComments();
      undoAll(document);
      applied = new WeakSet(); // 다시 켜면 모두 다시 적용한다
      problems.clear();
    }
    report(true);
    schedule();
  });
  report(true);
  schedule();
}

void start();

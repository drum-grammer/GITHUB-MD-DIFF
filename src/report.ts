/**
 * 화면을 못 읽거나 코멘트가 꺼졌을 때 — 페이지 구석에 이유와 "GitHub에 알리기" 링크를 띄운다.
 * 링크는 내용이 채워진 새 이슈 작성 화면을 열 뿐이고, 사람이 보고 제출해야 올라간다.
 * 비공개 저장소일 수 있으므로 저장소 이름·PR 주소·코멘트 글은 넣지 않는다.
 */
import { t } from './i18n';
import { MDF_ATTR } from './selectors';

export const ISSUES_NEW = 'https://github.com/drum-grammer/GITHUB-MD-DIFF/issues/new';
const TOAST = 'problem-toast';
const DISMISSED = 'mdf-dismissed:';

export interface ReportInfo {
  version: string;
  /** 사람이 읽는 이유(현재 언어) */
  reasons: string[];
  /** 문제 키와 실패한 요청 같은 진단 — 영어 */
  details: string[];
  /** new = 로그인한 새 화면, classic = 옛 화면 */
  page: 'new' | 'classic' | 'unknown';
  browser: string;
  date: string;
}

/** 새 이슈 작성 주소. 제목·본문을 채워 두고, 길면 줄인다 */
export function reportUrl(info: ReportInfo): string {
  const body = [
    '<!-- Filled in by Markdown Diff Cat. It has no repository name, pull request URL, or comment text. Add anything you can share. -->',
    '',
    '**What happened**',
    ...info.reasons.map((r) => `- ${r}`),
    '',
    '**Details**',
    ...info.details.map((d) => `- \`${d.replace(/`/g, "'")}\``),
    '',
    `- Extension: ${info.version}`,
    `- Page: ${info.page} "Files changed"`,
    `- Browser: ${info.browser}`,
    `- Date: ${info.date}`,
  ].join('\n');
  const params = new URLSearchParams({ title: `GitHub change? ${info.details[0] ?? 'problem'}`.slice(0, 120), body: body.slice(0, 4000) });
  return `${ISSUES_NEW}?${params}`;
}

/** 브라우저 이름과 주 버전만(전체 UA는 넣지 않는다) */
export function browserOf(ua: string): string {
  const m = ua.match(/(Edg|OPR|Chrome|Chromium|Firefox)\/(\d+)/);
  return m ? `${m[1] === 'Edg' ? 'Edge' : m[1]} ${m[2]}` : 'unknown';
}

function dismissedKey(details: string[]): string {
  return DISMISSED + details.join('|');
}

function isDismissed(details: string[]): boolean {
  try {
    return sessionStorage.getItem(dismissedKey(details)) === '1';
  } catch {
    return false;
  }
}

/**
 * 문제가 있으면 안내를 띄우고, 없어지면 걷는다. 같은 문제를 닫았으면 이 탭에서는 다시 띄우지 않는다.
 * 확장이 만든 요소라 끄면 undoAll이 걷는다.
 */
export function showProblemToast(doc: Document, info: ReportInfo | null): void {
  const old = doc.querySelector<HTMLElement>(`[${MDF_ATTR}="${TOAST}"]`);
  if (!info || info.details.length === 0 || isDismissed(info.details)) {
    old?.remove();
    return;
  }
  const url = reportUrl(info);
  if (old?.dataset.url === url) return;
  old?.remove();
  const box = doc.createElement('div');
  box.className = 'mdf-toast';
  box.setAttribute(MDF_ATTR, TOAST);
  box.setAttribute('role', 'status');
  box.dataset.url = url;
  const text = doc.createElement('span');
  text.textContent = `Markdown Diff Cat: ${info.reasons.join(' · ')}`;
  const link = doc.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = t('reportIssue');
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'mdf-toast-close';
  close.setAttribute('aria-label', t('close'));
  close.textContent = '×';
  close.addEventListener('click', () => {
    try {
      sessionStorage.setItem(dismissedKey(info.details), '1');
    } catch {
      // 저장 못 하면 이번에만 닫는다
    }
    box.remove();
  });
  box.append(text, link, close);
  doc.body.append(box);
}

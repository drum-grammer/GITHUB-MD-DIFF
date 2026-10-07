import { afterEach, describe, expect, it, vi } from 'vitest';
import { RETRY_MS, commentsBroken, commentsBrokenDetail, commentsReady, onCommentHealthChange, prepareComments } from '../src/comments';
import { RequestError, isGitHubChange } from '../src/github-api';
import { ISSUES_NEW, browserOf, reportUrl, showProblemToast, type ReportInfo } from '../src/report';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const route = { payload: { pullRequestsChangesRoute: { comparison: { fullDiff: { baseOid: 'b', headOid: 'h' } }, diffSummaries: [] } } };
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('isGitHubChange', () => {
  it('없어진 주소·다른 모양만 GitHub 변경으로 본다', () => {
    expect(isGitHubChange(new RequestError(404, 'HTTP 404'))).toBe(true);
    expect(isGitHubChange(new RequestError(0, 'unexpected route data'))).toBe(true);
    expect(isGitHubChange(new RequestError(502, 'HTTP 502'))).toBe(false);
    expect(isGitHubChange(new RequestError(403, 'HTTP 403'))).toBe(false);
    expect(isGitHubChange(new RequestError(422, 'Line could not be resolved'))).toBe(false);
    expect(isGitHubChange(new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('코멘트 기능 상태', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('정상이면 ready — 스레드 파일도 렌더링으로 열 수 있다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, route)));
    const changed = vi.fn();
    onCommentHealthChange(changed);
    prepareComments('https://github.com/o/r/pull/101/changes');
    expect(commentsReady('https://github.com/o/r/pull/101/changes')).toBe(false); // 읽는 중
    await settle();
    expect(commentsReady('https://github.com/o/r/pull/101/changes')).toBe(true);
    expect(changed).toHaveBeenCalled();
  });

  it('404면 broken — 코멘트를 끄고 까닭을 남긴다(저장소 이름 없이)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(404, { message: 'Not Found' })));
    prepareComments('https://github.com/o/r/pull/102/changes');
    await settle();
    expect(commentsReady('https://github.com/o/r/pull/102/changes')).toBe(false);
    expect(commentsBroken('https://github.com/o/r/pull/102/changes')).toBe(true);
    expect(commentsBrokenDetail('https://github.com/o/r/pull/102/changes')).toBe('GET pull/:n/changes: HTTP 404 Not Found');
  });

  it('5xx는 잠깐의 문제 — 알리지 않고 1분 뒤 다시 읽는다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fetchMock = vi.fn().mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, route));
    vi.stubGlobal('fetch', fetchMock);
    const url = 'https://github.com/o/r/pull/103/changes';
    prepareComments(url);
    await settle();
    expect(commentsBroken(url)).toBe(false);
    expect(commentsReady(url)).toBe(false);
    prepareComments(url);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 1분이 안 지났다
    vi.setSystemTime(Date.now() + RETRY_MS + 1);
    prepareComments(url);
    await settle();
    expect(commentsReady(url)).toBe(true);
  });

  it('커밋 일부만 보는 화면은 읽지도 않는다', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    prepareComments('https://github.com/o/r/pull/104/changes/abc');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('문제 보고', () => {
  const info: ReportInfo = {
    version: '1.1.0',
    reasons: ['코멘트 기능 꺼짐'],
    details: ['problemComments — GET pull/:n/changes: HTTP 404 Not Found'],
    page: 'new',
    browser: 'Chrome 130',
    date: '2026-10-08',
  };

  it('새 이슈 주소에 제목·본문을 채운다', () => {
    const url = new URL(reportUrl(info));
    expect(`${url.origin}${url.pathname}`).toBe(ISSUES_NEW);
    expect(url.searchParams.get('title')).toBe('GitHub change? problemComments — GET pull/:n/changes: HTTP 404 Not Found');
    const body = url.searchParams.get('body')!;
    expect(body).toContain('- 코멘트 기능 꺼짐');
    expect(body).toContain('Extension: 1.1.0');
    expect(body).toContain('Page: new');
  });

  it('브라우저는 이름과 주 버전만', () => {
    expect(browserOf('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0.6723.58 Safari/537.36')).toBe('Chrome 130');
  });

  it('안내를 띄우고, 닫으면 이 탭에서는 같은 문제로 다시 띄우지 않는다', () => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    showProblemToast(document, info);
    const toast = document.querySelector<HTMLElement>('[data-mdf="problem-toast"]')!;
    expect(toast.querySelector('a')!.getAttribute('href')).toBe(reportUrl(info));
    expect(toast.querySelector('a')!.getAttribute('rel')).toBe('noopener noreferrer');
    toast.querySelector<HTMLButtonElement>('button')!.click();
    expect(document.querySelector('[data-mdf="problem-toast"]')).toBeNull();
    showProblemToast(document, info);
    expect(document.querySelector('[data-mdf="problem-toast"]')).toBeNull();
    showProblemToast(document, { ...info, details: ['problemNoProseDiff'] });
    expect(document.querySelector('[data-mdf="problem-toast"]')).not.toBeNull();
    showProblemToast(document, null);
    expect(document.querySelector('[data-mdf="problem-toast"]')).toBeNull();
  });
});

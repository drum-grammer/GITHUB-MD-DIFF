import { expect, test, type Page } from '@playwright/test';
import { cli, makeRepo, startReview, type Repo } from './support';

let repo: Repo;
test.afterEach(() => repo?.cleanup());

const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="document.title=\'pwned\'"><script>document.title = "pwned"</script><rect width="10" height="10"/></svg>';

/** 페이지가 보내는 모든 요청과 CSP 위반을 모은다(Playwright의 init script는 CSP와 상관없이 들어간다) */
async function watch(page: Page): Promise<{ urls: string[]; violations: () => Promise<string[]> }> {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return { urls, violations: () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp) };
}

test('KaTeX·mermaid가 CSP 위반 없이 그려지고, 기본 상태에서는 localhost 밖으로 요청이 없다', async ({ page }) => {
  repo = makeRepo({ 'docs/a.md': '# A\n\nPlain.\n' });
  repo.write('docs/a.md', ['# A', '', 'Energy is $E = mc^2$ here.', '', '```mermaid', 'graph TD', '  A --> B', '```', '', '![remote](https://example.com/tracker.png)', ''].join('\n'));
  await page.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('89504e470d0a1a0a', 'hex') }));
  const seen = await watch(page);
  const review = await startReview(repo);
  await page.goto(review.url);
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('.mdc-mermaid svg')).toBeVisible({ timeout: 20_000 });
  expect(await seen.violations()).toEqual([]);
  const port = new URL(review.url).port;
  expect(seen.urls.filter((u) => !u.startsWith(`http://localhost:${port}/`))).toEqual([]);
  expect(seen.urls.some((u) => u.endsWith('/assets/mermaid.js'))).toBe(true);
  expect(seen.urls.some((u) => /\/assets\/fonts\/KaTeX_.+\.woff2$/.test(u))).toBe(true);

  // 사람이 "원격 이미지 보기"를 고른 뒤에만 바깥으로 — https만, CSP도 https:만 더한다
  await page.locator('.mdc-remote').click();
  await expect(page).toHaveURL(/\/\?remote=1$/);
  await expect(page.locator('img[data-mdc-remote]')).toHaveAttribute('src', 'https://example.com/tracker.png');
  await expect.poll(() => seen.urls.some((u) => u.startsWith('https://example.com/'))).toBe(true);
  expect(await seen.violations()).toEqual([]);
  await review.stop();
});

test('스크립트 든 SVG — 페이지 안 <img>로만 보이고, 최상위로 열면 내려받기(실행 안 됨)·sandbox CSP', async ({ page, context }) => {
  repo = makeRepo({ 'docs/a.md': '# A\n' });
  repo.write('docs/evil.svg', EVIL_SVG);
  repo.write('docs/a.md', '# A\n\n![evil](evil.svg)\n');
  const review = await startReview(repo);
  await page.goto(review.url);
  const src = await page.locator('img[src^="/file/"]').getAttribute('src');
  expect(src).toMatch(/^\/file\/[0-9a-f]{32}$/);
  const res = await page.request.get(new URL(src!, review.url).href);
  expect(res.headers()['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  expect(res.headers()['content-disposition']).toBe('attachment');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  const top = await context.newPage();
  const [download] = await Promise.all([top.waitForEvent('download'), top.goto(new URL(src!, review.url).href).catch(() => null)]);
  expect(download.suggestedFilename()).toBeTruthy();
  expect(await page.title()).not.toBe('pwned');
  await review.stop();
});

test('새로고침해도 그 탭의 API는 되고, 쓴 코드로 연 새 탭은 --reopen 안내만', async ({ page, browser }) => {
  repo = makeRepo({ 'a.md': '# A\n\none\n' });
  repo.write('a.md', '# A\n\ntwo\n');
  const review = await startReview(repo);
  await page.goto(review.url);
  await expect(page.locator('section.mdc-file')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('section.mdc-file')).toHaveCount(1);
  const other = await (await browser.newContext()).newPage();
  await other.goto(review.url);
  await expect(other.locator('.mdc-expired')).toContainText('markdown-diff-cat review --reopen');
  const fresh = /http:\/\/localhost:\d+\/\?code=[0-9a-f]{32}/.exec(cli(repo, 'review', '--reopen').stdout)![0];
  await other.goto(fresh);
  await expect(other.locator('section.mdc-file')).toHaveCount(1);
  await review.stop();
});

test('다른 출처 페이지의 요청은 거부된다(Origin 다름) — 세션 비밀을 알아도', async ({ page, browser }) => {
  repo = makeRepo({ 'a.md': '# A\n\none\n' });
  repo.write('a.md', '# A\n\ntwo\n');
  const review = await startReview(repo);
  await page.goto(review.url);
  const secret = await page.evaluate(() => sessionStorage.getItem('mdc-session'));
  const port = new URL(review.url).port;
  const evil = await (await browser.newContext()).newPage();
  await evil.route('http://attacker.test/', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' }));
  await evil.goto('http://attacker.test/');
  const status = await evil.evaluate(
    async ({ port, secret }) => {
      try {
        const res = await fetch(`http://localhost:${port}/api/send`, { method: 'POST', headers: { 'X-MDC-Session': secret ?? '', 'Content-Type': 'application/json' }, body: '{"rev":"r"}' });
        return res.status;
      } catch {
        return -1; // CORS가 응답을 막았다(서버는 이미 403으로 거부했다)
      }
    },
    { port, secret },
  );
  expect([403, -1]).toContain(status);
  expect(cli(repo, 'comments').stdout).toContain('No comments yet');
  await review.stop();
});

test('바뀐 mermaid는 바뀐 블록 하나로 보이고, 그림은 새 원문으로 그린다(CSP 위반 없음)', async ({ page }) => {
  repo = makeRepo({ 'docs/flow.md': ['# Flow', '', '```mermaid', 'graph TD', '  Start --> Old', '```', ''].join('\n') });
  repo.write('docs/flow.md', ['# Flow', '', '```mermaid', 'graph TD', '  Start --> Fresh', '```', ''].join('\n'));
  const seen = await watch(page);
  const review = await startReview(repo);
  await page.goto(review.url);
  await expect(page.locator('section.js-render-needs-enrichment.changed')).toHaveCount(1);
  const svg = page.locator('.mdc-mermaid svg');
  await expect(svg).toBeVisible({ timeout: 20_000 });
  await expect(svg).toContainText('Fresh');
  await expect(svg).not.toContainText('Old');
  expect(await seen.violations()).toEqual([]);
  await review.stop();
});

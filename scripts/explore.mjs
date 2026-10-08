// 공개 저장소의 마크다운 PR을 확장(dist)과 함께 열어 자동 렌더링·접기·표·코멘트 "+"·원문 줄 연결·문제 안내를 한꺼번에 본다.
// 읽기만 한다(블록에 마우스를 올리기만, 코멘트를 올리지 않는다). 비공개 저장소는 다루지 않는다.
// 쓰기: pnpm build && pnpm explore [결과 폴더] [targets.jsonl…] — 기본 .scratch/explore/<날짜>/, 대상은 pnpm explore:pick이 만든 것
// 결과: results.jsonl(PR마다 한 줄, 이어 쓰기 — 끊겨도 다시 부르면 끝난 PR은 건너뛴다)·shots/(문제가 보인 파일 캡처). 요약은 pnpm explore:report
// 동시에 여는 탭 수: EXPLORE_CONC(기본 3). 로그인 프로필(pnpm e2e:login)이 있어야 한다
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const OUT = args[0] ?? join('.scratch', 'explore', new Date().toISOString().slice(0, 10));
const TARGETS = args.length > 1 ? args.slice(1) : [join('.scratch', 'explore', 'targets.jsonl')];
const CONC = Number(process.env.EXPLORE_CONC ?? 3);
const LIMIT = Number(process.env.EXPLORE_LIMIT ?? 1e9);
mkdirSync(join(OUT, 'shots'), { recursive: true });
const RESULTS = join(OUT, 'results.jsonl');
const done = new Set(existsSync(RESULTS) ? readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);

const entry = join(mkdtempSync(join(tmpdir(), 'gmd-crawl-')), 'entry.mjs');
await build({ entryPoints: ['scripts/mapping-entry.ts'], bundle: true, format: 'esm', platform: 'node', outfile: entry, logLevel: 'silent' });
const dom = new JSDOM('<!doctype html><body></body>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element });
const lib = await import(entry);

const jobs = [];
for (const f of TARGETS) {
  for (const line of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const t = JSON.parse(line);
    if (t.private !== false) continue;
    for (const pr of t.prs) {
      const key = `${t.repo}#${pr.n}`;
      if (!done.has(key)) jobs.push({ key, repo: t.repo, n: pr.n, url: `https://github.com/${t.repo}/pull/${pr.n}/changes` });
    }
  }
}
jobs.splice(LIMIT);
console.log(`할 PR ${jobs.length}개 (끝난 것 ${done.size}개), 동시 ${CONC}`);

const DIST = resolve('dist');
const PROFILE = process.env.GMD_E2E_PROFILE ?? join(homedir(), '.cache', 'github-md-diff', 'e2e-profile');
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1400, height: 1000 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});
await ctx.addInitScript(() => {
  window.__mdfClicks = [];
  document.addEventListener(
    'click',
    (e) => {
      const b = e.target instanceof Element ? e.target.closest('button[aria-pressed]') : null;
      if (b) {
        window.__mdfClicks.push({
          t: Math.round(performance.now()),
          icon: b.querySelector('svg')?.getAttribute('class')?.replace('octicon octicon-', '') ?? '',
          file: b.closest('div[id^="diff-"]')?.id ?? '',
          trusted: e.isTrusted,
        });
      }
    },
    true,
  );
  window.__mdfLong = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__mdfLong.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
});

const STATE = () => {
  const MD = /\.(md|markdown|mdx)$/i;
  const files = [...document.querySelectorAll('div[id^="diff-"][class*="Diff-module__diff__"], div.file.js-file')];
  const label = (b) => b.getAttribute('aria-label') ?? (b.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent?.trim() ?? '').join(' ');
  const md = [];
  for (const f of files) {
    const code = f.querySelector('h3[class*="DiffFileHeader-module__file-name"] code');
    const spoken = code?.querySelector('.sr-only')?.textContent ?? '';
    const path = (spoken.includes(' renamed to ') ? spoken.split(' renamed to ').pop() : (code?.textContent ?? f.querySelector('.file-header[data-path]')?.getAttribute('data-path') ?? ''))
      .replace(/[\u200e\u200f]/g, '')
      .trim();
    if (!MD.test(path.split(/\s+/).pop() ?? '')) continue;
    const pressed = (icon) => f.querySelector(`button[aria-pressed] svg.octicon-${icon}`)?.closest('button')?.getAttribute('aria-pressed') ?? null;
    const header = f.querySelector('[class*="DiffFileHeader-module__diff-file-header"], .file-header');
    md.push({
      id: f.id,
      path,
      prose: Boolean(f.querySelector('.prose-diff .markdown-body')),
      rich: pressed('file'),
      source: pressed('code'),
      collapsed: [...(header?.querySelectorAll('button') ?? [])].some((b) => /Expand file/.test(label(b))),
      loadDiff: Boolean(f.querySelector('[class*="HiddenDiffPatch-module"]')),
      folds: f.querySelectorAll('[data-mdf="fold"]').length,
      tables: f.querySelectorAll('[data-mdf="table"]').length,
      hidden: f.querySelectorAll('.mdf-hidden').length,
      threads: f.querySelectorAll('[data-mdf="thread"]').length,
      noChange: Boolean(f.querySelector('[data-mdf="no-change"]')),
      // 접어서 숨긴 곳에 바뀐 곳 표시가 들어가면 안 된다(합친 표가 숨긴 원래 표 <del>/<ins>는 뺀다)
      hiddenChanges: [...f.querySelectorAll('.mdf-hidden')]
        .filter((h) => h.tagName !== 'DEL' && h.tagName !== 'INS' && !h.closest('del.mdf-hidden, ins.mdf-hidden'))
        .reduce((n, h) => n + (h.matches('ins, del, .changed, .added, .removed') ? 1 : 0) + h.querySelectorAll('ins, del, .changed, .added, .removed').length, 0),
      ghThreads: f.querySelectorAll('[class*="InlineReviewThread-module__ReviewThreadContainer"], tr.inline-comments').length,
      bodyText: Math.max(0, (f.textContent?.length ?? 0) - (header?.textContent?.length ?? 0)),
    });
  }
  const toast = document.querySelector('[data-mdf="problem-toast"]');
  return {
    vis: document.visibilityState,
    variant: document.querySelector('div[id^="diff-"][class*="Diff-module__diff__"]') ? 'new' : document.querySelector('div.file.js-file') ? 'classic' : 'unknown',
    login: Boolean(document.querySelector('meta[name="user-login"]')?.getAttribute('content')),
    files: files.length,
    md,
    toast: toast ? { text: toast.querySelector('span')?.textContent ?? '', href: toast.querySelector('a')?.getAttribute('href') ?? '' } : null,
    clicks: window.__mdfClicks ?? [],
    long: window.__mdfLong ?? [],
    title: document.title.slice(0, 80),
  };
};

const slug = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);

async function mapping(page) {
  // mapping-report.mjs와 같은 방식 — 렌더링 본문과 원문을 받아 jsdom에서 연결해 본다
  const got = await page.evaluate(async () => {
    const H = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true' };
    const r = await fetch(location.pathname, { headers: H, credentials: 'include' });
    if (!r.ok) return { error: `route ${r.status}` };
    const route = await r.json();
    const full = route.payload?.pullRequestsChangesRoute?.comparison?.fullDiff;
    if (!full) return { error: 'route shape' };
    const [, owner, repo] = location.pathname.split('/');
    const text = async (oid, path) => {
      const res = await fetch(`/${owner}/${repo}/_styled/${oid}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: H, credentials: 'include' });
      return res.ok ? res.json() : null;
    };
    const list = [];
    for (const file of document.querySelectorAll('div[id^="diff-"][class*="Diff-module__diff__"]')) {
      const prose = file.querySelector('.prose-diff .markdown-body');
      const code = file.querySelector('h3[class*="DiffFileHeader-module__file-name"] code');
      const spoken = code?.querySelector('.sr-only')?.textContent ?? '';
      const path = (spoken.includes(' renamed to ') ? spoken.split(' renamed to ').pop() : (code?.textContent ?? '')).replace(/[\u200e\u200f]/g, '').trim();
      if (!prose || !path) continue;
      const sum = route.payload.pullRequestsChangesRoute.diffSummaries?.find((s) => s.path === path);
      list.push({ path, oldPath: sum?.oldTreeEntry?.path ?? null, changeType: sum?.changeType ?? null, html: prose.outerHTML.length > 3e6 ? null : prose.outerHTML });
    }
    const some = list.slice(0, 8);
    for (const f of some) {
      f.head = f.changeType === 'DELETED' || f.changeType === 'REMOVED' ? null : await text(full.headOid, f.path);
      f.base = f.changeType === 'ADDED' ? null : await text(full.baseOid, f.oldPath ?? f.path);
    }
    return { list: some };
  });
  if (got.error) return [{ error: got.error }];
  const out = [];
  for (const f of got.list) {
    if (!f.html) {
      out.push({ path: f.path, error: 'html too large' });
      continue;
    }
    try {
      const body = new JSDOM(f.html).window.document.body.firstElementChild;
      const t0 = performance.now();
      const blocks = lib.domBlocks(body);
      const lines = (j) => (j ? (lib.findRawLines(j)?.join('\n') ?? null) : null);
      const head = lines(f.head);
      const base = lines(f.base);
      const map = lib.mapBlocks(blocks, head == null ? null : lib.sourceBlocks(head), base == null ? null : lib.sourceBlocks(base));
      const ms = Math.round(performance.now() - t0);
      const by = (side) => {
        const all = blocks.filter((b) => b.side === side);
        return [all.filter((b) => map.has(b.el)).length, all.length];
      };
      const miss = blocks.filter((b) => !map.has(b.el)).slice(0, 6).map((b) => `${b.side}:${b.kind}:${b.text.trim().slice(0, 60)}`);
      out.push({ path: f.path, right: by('right'), left: by('left'), ms, headOk: head != null, baseOk: base != null, changeType: f.changeType, miss });
    } catch (e) {
      out.push({ path: f.path, error: String(e).slice(0, 300) });
    }
  }
  return out;
}

async function plusCheck(page, md) {
  // 렌더링된 파일 앞쪽 3개에서, 첫 블록에 마우스를 올려 "+"가 나오는지
  const res = [];
  // 바뀐 곳이 안 보여 전부 접힌 파일은 올릴 블록이 없다
  for (const f of md.filter((x) => x.prose && !x.noChange).slice(0, 3)) {
    const file = page.locator(`[id="${f.id}"]`);
    // 확장이 만든 행(접기 막대 등)은 코멘트 블록이 아니다
    const blocks = file.locator('.prose-diff .markdown-body').locator('p:not([data-mdf]), li:not([data-mdf]), h1, h2, h3, h4, tr:not([data-mdf]):not(.mdf-fold-row)').filter({ visible: true });
    const block = (await blocks.count()) > 1 ? blocks.nth(1) : blocks.first();
    const plus = file.locator('[data-mdf="add-comment"]');
    let ok = false;
    const t0 = Date.now();
    try {
      await block.evaluate((el) => el.scrollIntoView({ block: 'center' }), undefined, { timeout: 3000 });
      // 처음 올리면 원문을 받는다 — 탭 여럿을 함께 열면 몇 초 걸린다
      for (let k = 0; k < 20 && !ok; k++) {
        await block.hover({ position: { x: 8 + (k % 3), y: 4 }, timeout: 3000 });
        ok = await plus.isVisible();
        if (!ok) await page.waitForTimeout(700);
      }
    } catch (e) {
      res.push({ path: f.path, ok: false, error: String(e).split('\n')[0].slice(0, 160) });
      continue;
    }
    res.push({ path: f.path, ok, ms: Date.now() - t0 });
  }
  return res;
}

async function crawl(job) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  const warns = [];
  cdp.on('Runtime.exceptionThrown', (e) => {
    const d = e.exceptionDetails;
    const where = d.url || d.stackTrace?.callFrames?.[0]?.url || '';
    if (/chrome-extension:/.test(where)) errors.push(`${d.exception?.description ?? d.text}`.slice(0, 400));
  });
  cdp.on('Runtime.consoleAPICalled', (e) => {
    const text = e.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (/github-md-diff/.test(text)) warns.push(`${e.type}: ${text}`.slice(0, 500));
  });
  await cdp.send('Runtime.enable');
  const t0 = Date.now();
  const rec = { key: job.key, repo: job.repo, n: job.n, at: new Date().toISOString() };
  try {
    const resp = await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    rec.status = resp?.status() ?? 0;
    let s = await page.evaluate(STATE);
    let stable = 0;
    while (Date.now() - t0 < 45_000) {
      await page.waitForTimeout(1500);
      s = await page.evaluate(STATE);
      const busy = s.md.some((f) => !f.prose && f.rich === 'true' && !f.collapsed);
      stable = busy ? 0 : stable + 1;
      if (Date.now() - t0 > 9000 && stable >= 3) break;
    }
    rec.ms = Date.now() - t0;
    const ext = s.clicks.filter((c) => !c.trusted);
    rec.extClicks = ext.length;
    rec.fellBack = s.md.filter((f) => !f.prose && ext.some((c) => c.file === f.id && c.icon === 'code')).map((f) => f.path);
    delete s.clicks;
    rec.state = s;
    if (s.login && s.variant === 'new' && s.md.some((f) => f.prose)) {
      rec.plus = await plusCheck(page, s.md);
      rec.mapping = await mapping(page).catch((e) => [{ error: `crawler: ${String(e).split('\n')[0].slice(0, 200)}` }]);
    }
    rec.toastAfter = (await page.evaluate(STATE)).toast;
    rec.errors = errors;
    rec.warns = warns;
    // 캡처: 안내가 떴거나, 되돌림·렌더링 없음, 예외, "+" 실패, 매핑 90% 미만
    const bad = new Set();
    for (const f of s.md) if (!f.prose && !f.collapsed && f.rich !== null) bad.add(f.id);
    for (const p of rec.plus ?? []) if (!p.ok) bad.add(s.md.find((f) => f.path === p.path)?.id);
    for (const m of rec.mapping ?? []) {
      if (m.error || !m.right) continue;
      const [a, b] = [m.right[0] + m.left[0], m.right[1] + m.left[1]];
      if (b > 0 && a / b < 0.9) bad.add(s.md.find((f) => f.path === m.path)?.id);
    }
    rec.shots = [];
    const pfx = `${slug(job.repo)}-${job.n}`;
    if (s.toast || errors.length) {
      await page.screenshot({ path: join(OUT, 'shots', `${pfx}-page.png`) });
      rec.shots.push(`${pfx}-page.png`);
    }
    for (const id of [...bad].filter(Boolean).slice(0, 3)) {
      const el = page.locator(`[id="${id}"]`);
      const name = `${pfx}-${id.slice(5, 15)}.png`;
      try {
        await el.scrollIntoViewIfNeeded({ timeout: 3000 });
        const box = await el.boundingBox();
        if (!box) continue;
        await page.screenshot({ path: join(OUT, 'shots', name), fullPage: true, clip: { x: box.x, y: box.y + (await page.evaluate(() => scrollY)), width: box.width, height: Math.min(box.height, 2500) } });
        rec.shots.push(name);
      } catch {}
    }
  } catch (e) {
    rec.crash = String(e).split('\n')[0].slice(0, 300);
    rec.errors = errors;
    rec.warns = warns;
  }
  appendFileSync(RESULTS, JSON.stringify(rec) + '\n');
  const s = rec.state;
  console.log(
    `${rec.crash ? 'CRASH' : 'ok'} ${job.key} ${rec.ms ?? '-'}ms md=${s?.md.length ?? '-'} prose=${s?.md.filter((f) => f.prose).length ?? '-'} toast=${s?.toast ? 'Y' : 'n'} fb=${rec.fellBack?.length ?? 0} err=${rec.errors?.length ?? 0} warn=${rec.warns?.length ?? 0}`,
  );
  await page.close().catch(() => {});
}

let next = 0;
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (next < jobs.length) await crawl(jobs[next++]);
  }),
);
await ctx.close();
console.log('끝');

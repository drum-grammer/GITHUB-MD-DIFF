// 확장이 GitHub 화면을 얼마나 느리게 하는지 잰다 — 같은 PR을 확장을 끈 채(off)·켠 채(on) 번갈아 열어 비교한다. 읽기만 한다.
// 쓰기: pnpm perf [--reps 2] [--window 20] [--out 파일.json] [PR changes 주소…] — 주소가 없으면 아래 기본 묶음(공개 PR)
// 보는 것: 확장 코드의 CPU 시간(CPU 프로파일에서 chrome-extension:// 몫)과 많이 쓴 함수, 50ms 넘는 작업(개수·합·최대·TBT),
//   페이지 전체 스크립트·레이아웃 시간, md 파일이 렌더링되기까지(첫·전부), GitHub 렌더링 → 확장 접기까지, 큰 파일에 처음 마우스를 올려 "+"가 나오기까지
// 로그인 프로필(pnpm e2e:login)이 있어야 한다. 결과 표는 터미널에, 자세한 값은 --out JSON에
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const DEFAULT = [
  'https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/6/changes', // md 1개·표
  'https://github.com/kubernetes/website/pull/57929/changes', // HTML 표가 큰 문서
  'https://github.com/EbookFoundation/free-programming-books/pull/13505/changes', // 목록 수천 줄
  'https://github.com/public-apis/public-apis/pull/7827/changes', // 아주 큰 README 표
  'https://github.com/MicrosoftDocs/PowerShell-Docs/pull/13281/changes', // 리뷰 스레드·큰 문서 5개
  'https://github.com/github/docs/pull/46153/changes', // md 30개
  'https://github.com/reactjs/ko.react.dev/pull/1565/changes', // md 56개·한국어
  'https://github.com/microsoft/vscode-docs/pull/10431/changes', // md 334개
];

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const REPS = Number(opt('--reps', '2'));
const WINDOW = Number(opt('--window', '20')) * 1000;
const OUT = opt('--out', join('.scratch', 'perf', `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`));
const URLS = args.length ? args : DEFAULT;
const PROFILE = process.env.GMD_E2E_PROFILE ?? join(homedir(), '.cache', 'github-md-diff', 'e2e-profile');
const DIST = resolve('dist');

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1400, height: 1000 },
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const setEnabled = (on) => sw.evaluate((v) => chrome.storage.local.set({ enabled: v }), on);

// 페이지 쪽 기록 — 긴 작업, md 파일마다 렌더링 본문이 처음 보인 때와 확장의 접기 막대가 처음 붙은 때
await ctx.addInitScript(() => {
  const w = window;
  w.__perf = { long: [], prose: {}, fold: {} };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__perf.long.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  const seen = () => {
    const now = Math.round(performance.now());
    for (const f of document.querySelectorAll('div[id^="diff-"][class*="Diff-module__diff__"], div.file.js-file')) {
      if (!(f.id in w.__perf.prose) && f.querySelector('.prose-diff .markdown-body')) w.__perf.prose[f.id] = now;
      if (!(f.id in w.__perf.fold) && f.querySelector('[data-mdf="fold"], [data-mdf="table"], [data-mdf="no-change"]')) w.__perf.fold[f.id] = now;
    }
  };
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      seen();
    }, 50);
  }).observe(document, { childList: true, subtree: true });
});

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

/** CPU 프로파일에서 확장 코드가 쓴 시간(ms)과 함수별 자기 시간 */
function extensionTime(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i] ?? 0) / 1000;
    self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + dt);
  }
  let total = 0;
  const fns = new Map();
  for (const [id, ms] of self) {
    const cf = byId.get(id)?.callFrame;
    if (!cf?.url?.startsWith('chrome-extension://')) continue;
    total += ms;
    const k = `${cf.functionName || '(anonymous)'}:${cf.lineNumber + 1}`;
    fns.set(k, (fns.get(k) ?? 0) + ms);
  }
  return { total, top: [...fns].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, ms]) => [k, Math.round(ms)]) };
}

async function run(url, mode) {
  await setEnabled(mode === 'on');
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(WINDOW);
  const { profile } = await cdp.send('Profiler.stop');
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const p = await page.evaluate(() => {
    const md = [...document.querySelectorAll('div[id^="diff-"][class*="Diff-module__diff__"], div.file.js-file')].filter((f) => /\.(md|markdown|mdx)$/i.test((f.querySelector('h3 code')?.textContent ?? f.querySelector('.file-header[data-path]')?.getAttribute('data-path') ?? '').replace(/[\u200e\u200f]/g, '').trim()));
    return { ...window.__perf, md: md.map((f) => f.id) };
  });
  const r = { url, mode, md: p.md.length };
  const prose = p.md.map((id) => p.prose[id]).filter((t) => t != null);
  r.proseCount = prose.length;
  r.firstProse = prose.length ? Math.min(...prose) : null;
  r.lastProse = prose.length ? Math.max(...prose) : null;
  const lag = p.md.filter((id) => p.prose[id] != null && p.fold[id] != null).map((id) => p.fold[id] - p.prose[id]);
  r.foldLagMedian = median(lag);
  r.foldLagMax = lag.length ? Math.max(...lag) : null;
  const long = p.long.map(([, d]) => d);
  r.longCount = long.length;
  r.longMax = long.length ? Math.max(...long) : 0;
  r.tbt = long.reduce((s, d) => s + Math.max(0, d - 50), 0);
  r.scriptMs = Math.round((metrics.ScriptDuration ?? 0) * 1000);
  r.layoutMs = Math.round(((metrics.LayoutDuration ?? 0) + (metrics.RecalcStyleDuration ?? 0)) * 1000);
  const ext = extensionTime(profile);
  r.extMs = Math.round(ext.total);
  r.extTop = ext.top;
  // 확장을 켰을 때만: 렌더링된 md 중 블록이 가장 많은 파일에 처음 마우스를 올려 "+"가 나오기까지와 그동안의 긴 작업
  if (mode === 'on' && prose.length) {
    const target = await page.evaluate(() => {
      let best = null;
      for (const f of document.querySelectorAll('div[id^="diff-"][class*="Diff-module__diff__"], div.file.js-file')) {
        const n = f.querySelectorAll('.prose-diff .markdown-body p, .prose-diff .markdown-body li, .prose-diff .markdown-body tr').length;
        if (n && (!best || n > best.n)) best = { id: f.id, n };
      }
      return best;
    });
    if (target) {
      const file = page.locator(`[id="${target.id}"]`);
      const block = file
        .locator('.prose-diff .markdown-body')
        .locator('p:not([data-mdf]), li:not([data-mdf]), h2, h3, tr:not([data-mdf]):not(.mdf-fold-row)')
        .filter({ visible: true })
        .first();
      const plus = file.locator('[data-mdf="add-comment"]');
      try {
        await block.evaluate((el) => el.scrollIntoView({ block: 'center' }), undefined, { timeout: 3000 });
        const before = await page.evaluate(() => window.__perf.long.length);
        const t0 = Date.now();
        let ok = false;
        for (let k = 0; k < 60 && !ok; k++) {
          await block.hover({ position: { x: 8 + (k % 3), y: 4 }, timeout: 2000 });
          ok = await plus.isVisible();
          if (!ok) await page.waitForTimeout(100);
        }
        const during = await page.evaluate((n) => window.__perf.long.slice(n).map(([, d]) => d), before);
        r.hover = { blocks: target.n, ok, ms: Date.now() - t0, longMax: during.length ? Math.max(...during) : 0, longSum: during.reduce((s, d) => s + d, 0) };
      } catch (e) {
        r.hover = { blocks: target.n, ok: false, error: String(e).split('\n')[0].slice(0, 120) };
      }
    }
  }
  await page.close();
  return r;
}

const results = [];
for (const url of URLS) {
  for (let rep = 0; rep < REPS; rep++) {
    for (const mode of ['off', 'on']) {
      const r = await run(url, mode);
      results.push(r);
      const short = url.replace('https://github.com/', '').replace('/changes', '');
      console.log(
        `${short} ${mode} md=${r.md} prose=${r.proseCount} ext=${r.extMs}ms script=${r.scriptMs}ms long=${r.longCount}/max${r.longMax}/tbt${r.tbt} ` +
          `first=${r.firstProse} last=${r.lastProse} foldLag=${r.foldLagMedian}/${r.foldLagMax}${r.hover ? ` hover=${r.hover.ms}ms/long${r.hover.longMax}` : ''}`,
      );
    }
  }
}
await ctx.close();

// PR·모드마다 중앙값
const summary = [];
for (const url of URLS) {
  const row = { pr: url.replace('https://github.com/', '').replace('/pull/', '#').replace('/changes', '') };
  for (const mode of ['off', 'on']) {
    const rs = results.filter((r) => r.url === url && r.mode === mode);
    const m = (k) => median(rs.map((r) => r[k]).filter((v) => v != null));
    row[mode] = { md: m('md'), prose: m('proseCount'), extMs: m('extMs'), scriptMs: m('scriptMs'), layoutMs: m('layoutMs'), tbt: m('tbt'), longMax: m('longMax'), firstProse: m('firstProse'), lastProse: m('lastProse'), foldLag: m('foldLagMedian') };
    if (mode === 'on') {
      const hs = rs.map((r) => r.hover).filter(Boolean);
      row.hover = { ms: median(hs.map((h) => h.ms ?? 0)), longMax: median(hs.map((h) => h.longMax ?? 0)), blocks: hs[0]?.blocks };
      row.extTop = rs[0]?.extTop;
    }
  }
  summary.push(row);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), window: WINDOW, reps: REPS, summary, results }, null, 1));
console.log('\nPR | 확장 CPU(ms) | 스크립트 off→on(ms) | TBT off→on | 최대 작업 off→on | 렌더링 md(on) | 처음/전부 렌더링(on, ms) | 렌더링→접기(ms) | 처음 "+"(ms, 그동안 최대 작업)');
for (const r of summary) {
  console.log(
    `${r.pr} | ${r.on.extMs} | ${r.off.scriptMs}→${r.on.scriptMs} | ${r.off.tbt}→${r.on.tbt} | ${r.off.longMax}→${r.on.longMax} | ${r.on.prose}/${r.on.md} | ${r.on.firstProse}/${r.on.lastProse} | ${r.on.foldLag} | ${r.hover?.ms ?? '-'} (${r.hover?.longMax ?? '-'})`,
  );
}
console.log(`\n${OUT}`);

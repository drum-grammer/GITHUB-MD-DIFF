// 실제 GitHub에서 확장이 기대는 것을 점검한다 — 읽기만 한다(코멘트를 올리지 않는다). 하나라도 깨지면 종료 코드 1.
// 쓰기: pnpm canary [--notify] — 로그인 프로필(pnpm e2e:login)이 있어야 한다. 결과는 ~/.cache/github-md-diff/canary.log에 한 줄씩 쌓인다.
// --notify: 깨지면 macOS 알림을 띄우고, 내용이 채워진 GitHub 이슈 작성 주소를 출력한다(이슈를 올리지는 않는다)
// --status [--max-days N]: 점검을 돌리지 않고 마지막 기록만 본다 — N일(기본 2) 넘게 안 돌았거나 마지막이 깨졌으면 종료 코드 1.
//   2026-10-11~14 예약해 둔 점검이 한 번도 돌지 않아 GitHub 화면 변경을 사용자가 먼저 겪었다 — 점검이 멈춘 것도 알아야 한다
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GITHUB_CSS } from './page-css.mjs';

const REPO = 'drum-grammer/GITHUB-MD-DIFF';
const PR = 6; // 데모 PR — demo/design-doc.md 하나
const FILE = 'demo/design-doc.md';
const PROFILE = process.env.GMD_E2E_PROFILE ?? join(homedir(), '.cache', 'github-md-diff', 'e2e-profile');
const DIST = resolve('dist');
const LOG = join(homedir(), '.cache', 'github-md-diff', 'canary.log');
const MIN_COVERAGE = 0.95;
const notify = process.argv.includes('--notify');

if (process.argv.includes('--status')) {
  const i = process.argv.indexOf('--max-days');
  const maxDays = i > 0 ? Number(process.argv[i + 1]) : 2;
  const lines = existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : [];
  const last = lines.length ? JSON.parse(lines.at(-1)) : null;
  if (!last) {
    console.log(`✗ 점검 기록이 없다 — ${LOG}. 이 기기에서 pnpm canary가 한 번도 돌지 않았다`);
    process.exit(1);
  }
  const days = (Date.now() - Date.parse(last.at)) / 86_400_000;
  const stale = days > maxDays;
  console.log(`${stale || !last.ok ? '✗' : '✓'} 마지막 점검 ${last.at.slice(0, 16).replace('T', ' ')}Z(${days.toFixed(1)}일 전) · 확장 ${last.version} · ${last.ok ? '정상' : `깨짐 — ${last.failed.join(' / ')}`}${stale ? ` · ${maxDays}일 넘게 돌지 않았다` : ''}`);
  process.exit(stale || !last.ok ? 1 : 0);
}

const results = [];
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '' });
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: String(e?.message ?? e).split('\n')[0].slice(0, 300) });
    console.log(`✗ ${name} — ${results.at(-1).detail}`);
  }
}
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const out = join(mkdtempSync(join(tmpdir(), 'gmd-canary-')), 'entry.mjs');
await build({ entryPoints: ['scripts/mapping-entry.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const dom = new JSDOM('<!doctype html><body></body>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element });
const lib = await import(out);

const args = [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`];
const context = await chromium.launchPersistentContext(PROFILE, { channel: 'chromium', headless: true, args });
const page = context.pages()[0] ?? (await context.newPage());
const file = page.locator(GITHUB_CSS.file);
let route = null;
let head = null;

await check('로그인 상태', async () => {
  await page.goto(`https://github.com/${REPO}/pull/${PR}/changes`);
  const login = await page.locator('meta[name="user-login"]').getAttribute('content');
  must(login, '로그인이 풀렸다 — pnpm e2e:login');
  return login;
});

await check('PR 데이터(GET pull/:n/changes JSON) 모양', async () => {
  route = await page.evaluate(async () => {
    const r = await fetch(location.pathname, {
      headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true' },
      credentials: 'include',
    });
    return { status: r.status, body: await r.text() };
  });
  must(route.status === 200, `HTTP ${route.status}`);
  const d = lib.parsePrData(JSON.parse(route.body));
  must(/^[0-9a-f]{40}$/.test(d.headOid) && /^[0-9a-f]{40}$/.test(d.baseOid), '커밋 SHA 모양이 다르다');
  must(d.files.has(FILE), `${FILE} 요약이 없다`);
  const raw = JSON.parse(route.body).payload.pullRequestsChangesRoute;
  must(raw.markers && typeof raw.markers.threads === 'object', 'markers.threads가 없다');
  must(raw.diffSummaries.every((s) => typeof s.markersMap === 'object'), 'markersMap이 없다');
  route.data = d;
  return `head ${d.headOid.slice(0, 7)}`;
});

await check('파일 원문(_styled rawLines)', async () => {
  must(route?.data, 'PR 데이터가 없다');
  const r = await page.evaluate(
    async ([oid, path]) => {
      const res = await fetch(`/drum-grammer/GITHUB-MD-DIFF/_styled/${oid}/${path}`, {
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true' },
        credentials: 'include',
      });
      return { status: res.status, body: await res.text() };
    },
    [route.data.headOid, FILE],
  );
  must(r.status === 200, `HTTP ${r.status}`);
  const lines = lib.findRawLines(JSON.parse(r.body));
  must(lines && lines.length > 50, 'rawLines가 없다');
  head = lines.join('\n');
  return `${lines.length}줄`;
});

await check('화면: 자동 렌더링·접기·표 합치기', async () => {
  await file.locator('.prose-diff .markdown-body').waitFor({ timeout: 30_000 });
  await file.locator('[data-mdf="fold"]').first().waitFor({ timeout: 10_000 });
  await file.locator('[data-mdf="table"]').waitFor({ timeout: 10_000 });
});

await check('화면: 블록 "+"와 원문 줄(49번째 줄)', async () => {
  const para = file.locator('.markdown-body p', { hasText: 'A reconciler runs every' });
  const plus = file.locator('[data-mdf="add-comment"]');
  for (let k = 0; k < 40 && !(await plus.isVisible()); k++) {
    await para.hover({ position: { x: 8 + (k % 5), y: 6 } });
    await page.waitForTimeout(250);
  }
  must(await plus.isVisible(), '"+"가 나오지 않는다');
  await plus.click();
  const label = await file.locator('[data-mdf="comment-form"] .mdf-comment-label').textContent();
  must(/\bR49\b/.test(label ?? ''), `줄 표시가 다르다: ${label}`);
  await file.locator('[data-mdf="comment-form"] .mdf-comment-actions > button').first().click(); // 취소 — 올리지 않는다
  return label;
});

// 확장은 클래스 이름이 바뀌어도 파일 앵커 id·구조로 버틴다 — 그래서 클래스 형식이 또 바뀐 것은 여기서만 보인다. 사용자가 겪기 전에 고친다
await check('클래스 이름 형식(새 화면 파일 묶음)', async () => {
  const n = await page.evaluate((css) => ({
    structure: document.querySelectorAll(css.file).length,
    old: document.querySelectorAll(css.fileClassOld).length,
    new: document.querySelectorAll(css.fileClassNew).length,
  }), GITHUB_CSS);
  must(n.structure > 0, '구조로도 파일 묶음을 못 찾는다');
  must(n.old + n.new > 0, `GitHub가 클래스 이름 형식을 또 바꿨다(옛 ${n.old}·새 ${n.new}·구조 ${n.structure}) — 확장은 id·구조로 돌지만 src/selectors.ts의 moduleClass를 맞춘다`);
  return n.new ? `새 형식(diff__해시) ${n.new}` : `옛 형식(Diff-module__…) ${n.old}`;
});

await check('확장 경고 없음(툴바 "!"·구석 안내)', async () => {
  const toast = await page.locator('[data-mdf="problem-toast"]').count();
  must(toast === 0, `확장이 화면을 못 읽는다고 알렸다: ${await page.locator('[data-mdf="problem-toast"]').first().textContent()}`);
});

await check(`연결률(≥ ${MIN_COVERAGE * 100}%)`, async () => {
  must(head, '원문이 없다');
  const html = await file.locator('.prose-diff .markdown-body').evaluate((el) => el.outerHTML);
  const body = new JSDOM(html).window.document.body.firstElementChild;
  const blocks = lib.domBlocks(body);
  const map = lib.mapBlocks(blocks, lib.sourceBlocks(head), null);
  const right = blocks.filter((b) => b.side === 'right');
  const rate = right.filter((b) => map.has(b.el)).length / Math.max(1, right.length);
  must(rate >= MIN_COVERAGE, `${(rate * 100).toFixed(1)}%`);
  return `${(rate * 100).toFixed(1)}% (${right.length}블록)`;
});
await context.close();

await check('로그아웃 옛 화면(/files): 렌더링·접기', async () => {
  const anon = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gmd-canary-anon-')), { channel: 'chromium', headless: true, args });
  try {
    const p = anon.pages()[0] ?? (await anon.newPage());
    await p.goto(`https://github.com/${REPO}/pull/${PR}/files`);
    await p.locator('div.file.js-file .prose-diff .markdown-body').first().waitFor({ timeout: 30_000 });
    await p.locator('[data-mdf="fold"]').first().waitFor({ timeout: 10_000 });
  } finally {
    await anon.close();
  }
});

const failed = results.filter((r) => !r.ok);
const version = JSON.parse(execFileSync('node', ['-p', 'JSON.stringify(require("./static/manifest.json"))'], { encoding: 'utf8' })).version;
mkdirSync(join(homedir(), '.cache', 'github-md-diff'), { recursive: true });
appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), version, ok: failed.length === 0, failed: failed.map((r) => `${r.name}: ${r.detail}`) })}\n`);
console.log(failed.length ? `\n깨짐 ${failed.length}/${results.length} — 기록: ${LOG}` : `\n모두 정상 ${results.length}/${results.length} — 기록: ${LOG}`);

if (failed.length && notify) {
  const body = [
    'Found by `pnpm canary` (read-only check against live GitHub).',
    '',
    ...failed.map((r) => `- ${r.name}: \`${r.detail}\``),
    '',
    `- Extension: ${version}`,
    `- Date: ${new Date().toISOString().slice(0, 10)}`,
  ].join('\n');
  const url = `https://github.com/${REPO}/issues/new?${new URLSearchParams({ title: `Canary: ${failed[0].name}`, body })}`;
  console.log(`\n이슈로 남기려면(내용이 채워져 열린다):\n${url}`);
  if (process.platform === 'darwin') {
    const msg = `${failed.length}개 깨짐 — ${failed[0].name}`.replace(/"/g, "'");
    try {
      execFileSync('osascript', ['-e', `display notification "${msg}" with title "Markdown Diff Cat 점검"`]);
    } catch {
      // 알림을 못 띄워도 결과는 남는다
    }
  }
}
process.exit(failed.length ? 1 : 0);

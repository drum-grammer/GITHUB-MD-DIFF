// 같은 testbed 시나리오(review)를 GitHub PR 화면(확장 켬, 로그인 프로필)과 로컬 리뷰 페이지에서 밝음·어두움으로 찍어 나란히 놓는다 — 읽기만
// 준비(저장소 루트): pnpm build(확장 dist) · pnpm --filter markdown-diff-cat build · pnpm e2e:login(한 번) · gh auth login · pnpm testbed:setup(PR이 있어야)
// 어두움 캡처는 GitHub 계정 Appearance가 "Sync with system"이어야 맞다(그렇지 않으면 GitHub 쪽은 계정 테마로 찍힌다)
// 실행(저장소 루트): node packages/review/scripts/capture-compare.mjs → .scratch/review-compare/<날짜>/report.html
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { launch } from '../../../scripts/mapping-launch.mjs';
import { installPageCss } from '../../../scripts/page-css.mjs';
import { REPO, baseFiles, headFiles } from '../../../testbed/scenarios.ts';

const FILES = ['docs/handbook.md', 'docs/pricing.md'];
const SCHEMES = ['light', 'dark'];
const OUT = resolve('.scratch/review-compare', new Date().toISOString().slice(0, 10));
const CLI = resolve('packages/review/dist/markdown-diff-cat.mjs');
const URL_RE = /http:\/\/localhost:\d+\/\?code=[0-9a-f]{32}/;
mkdirSync(OUT, { recursive: true });

/** 기준 커밋 = testbed 기본 파일, 작업 트리 = review 시나리오를 적용한 파일(지운 파일은 지운다) */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mdc-compare-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  const write = (files) => {
    for (const [p, t] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), t);
    }
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'compare@example.com');
  git('config', 'user.name', 'compare');
  git('config', 'commit.gpgsign', 'false');
  write(baseFiles());
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const head = headFiles('review');
  for (const p of Object.keys(baseFiles())) if (!(p in head)) rmSync(join(dir, p));
  write(head);
  return dir;
}

function startReview(dir, state) {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [CLI, 'review'], { cwd: dir, env: { ...process.env, MDC_STATE_DIR: state }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (d) => {
      out += d;
      const m = URL_RE.exec(out);
      if (m) ok({ url: m[0], child });
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.once('exit', (code) => fail(new Error(`review exited (${code}): ${out}`)));
  });
}

const shotName = (file, side, scheme) => `${file.replaceAll('/', '_')}-${side}-${scheme}.png`;

const prNumber = execFileSync('gh', ['pr', 'list', '--repo', REPO, '--head', 'scenario/review', '--state', 'open', '--json', 'number', '--jq', '.[0].number'], { encoding: 'utf8' }).trim();
if (!prNumber) throw new Error(`${REPO}에 열린 scenario/review PR이 없다 — pnpm testbed:setup을 먼저`);

// 로컬 페이지
const dir = makeRepo();
const state = mkdtempSync(join(tmpdir(), 'mdc-compare-state-'));
const { url, child } = await startReview(dir, state);
const browser = await chromium.launch({ channel: 'chromium' });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(url);
await page.waitForSelector('section.mdc-file');
for (const scheme of SCHEMES) {
  await page.emulateMedia({ colorScheme: scheme });
  for (const f of FILES) {
    await page.locator('section.mdc-file', { has: page.locator('.mdc-file-head .mdc-path', { hasText: f }) }).screenshot({ path: join(OUT, shotName(f, 'local', scheme)) });
  }
}
await browser.close();
execFileSync(process.execPath, [CLI, 'stop', '--clean'], { cwd: dir, env: { ...process.env, MDC_STATE_DIR: state } });
await new Promise((r) => (child.exitCode === null ? child.once('exit', r) : r()));

// GitHub PR(확장 켬, 로그인 프로필 — 읽기만)
const github = await launch();
await installPageCss(github);
const gp = github.pages()[0] ?? (await github.newPage());
await gp.setViewportSize({ width: 1280, height: 900 });
await gp.goto(`https://github.com/${REPO}/pull/${prNumber}/changes`);
await gp.waitForSelector('[data-mdf="file-toolbar"]', { timeout: 60_000 });
for (const scheme of SCHEMES) {
  await gp.emulateMedia({ colorScheme: scheme });
  for (const [i, f] of FILES.entries()) {
    const found = await gp.evaluate(
      ({ f, i }) => {
        const el = window.__mdf.files().find((x) => window.__mdf.path(x) === f);
        el?.setAttribute('data-mdc-capture', String(i));
        el?.scrollIntoView();
        return Boolean(el);
      },
      { f, i },
    );
    if (!found) throw new Error(`GitHub 화면에서 ${f}를 찾지 못했다`);
    await gp.waitForTimeout(500);
    await gp.locator(`[data-mdc-capture="${i}"]`).screenshot({ path: join(OUT, shotName(f, 'github', scheme)) });
  }
}
await github.close();
rmSync(dir, { recursive: true, force: true });
rmSync(state, { recursive: true, force: true });

const rows = FILES.flatMap((f) => SCHEMES.map((s) => `<tr><th>${f}<br>${s}</th><td><img src="${shotName(f, 'github', s)}"></td><td><img src="${shotName(f, 'local', s)}"></td></tr>`));
writeFileSync(
  join(OUT, 'report.html'),
  `<!doctype html><meta charset="utf-8"><title>GitHub vs local review</title><style>body{font:14px system-ui;margin:16px}table{border-collapse:collapse}td,th{vertical-align:top;padding:8px;border:1px solid #999}img{width:600px}</style><h1>GitHub (extension on) vs local review — ${basename(OUT)}</h1><p>${REPO}#${prNumber} · scenario/review. GitHub dark captures need the account appearance set to "Sync with system".</p><table><tr><th></th><th>GitHub</th><th>Local</th></tr>${rows.join('')}</table>\n`,
);
console.log(`보고서: ${join(OUT, 'report.html')}`);

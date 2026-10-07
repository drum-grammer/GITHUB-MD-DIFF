// 시연 PR 캡처: 확장 없이(전) / 확장 켜고(후) — 파일 영역만 자른다(계정 정보가 찍히지 않게)
// 사용: node store/capture.mjs [en|ko]  (먼저 pnpm build, pnpm e2e:login으로 로그인한 테스트 프로필 필요)
import { chromium } from '@playwright/test';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PR = process.env.DEMO_PR ?? 'https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/6/changes';
const PROFILE = process.env.GMD_E2E_PROFILE ?? join(homedir(), '.cache', 'github-md-diff', 'e2e-profile');
// 맥 Chromium은 --lang을 무시하고 시스템 언어를 따른다 — 영어판은 한국어 문구를 뺀 빌드 사본을 올린다
const DIST = resolve(`store/build/dist-${process.argv[2] ?? 'en'}`);
rmSync(DIST, { recursive: true, force: true });
cpSync(resolve('dist'), DIST, { recursive: true });
if ((process.argv[2] ?? 'en') === 'en') rmSync(`${DIST}/_locales/ko`, { recursive: true, force: true });
const LANG = process.argv[2] ?? 'en';
const OUT = resolve(`store/build/capture/${LANG}`);
mkdirSync(OUT, { recursive: true });
const FILE = 'div[id^="diff-"][class*="Diff-module__diff__"]';

// 화면 위에 붙어 다니는 머리(PR 제목·파일 머리)가 긴 캡처 한가운데 찍히지 않게 풀어 둔다
const unstick = (page) =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const pos = getComputedStyle(el).position;
      if (pos === 'sticky' || pos === 'fixed') el.style.setProperty('position', 'static', 'important');
    }
  });

async function open(withExtension) {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 },
    locale: LANG === 'ko' ? 'ko-KR' : 'en-US',
    deviceScaleFactor: 2,
    colorScheme: 'light',
    args: [`--lang=${LANG === 'ko' ? 'ko' : 'en-US'}`, ...(withExtension ? [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`] : ['--disable-extensions'])],
  });
  if (withExtension) {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    await sw.evaluate(() => chrome.storage.local.set({ enabled: true }));
  }
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(PR);
  // 파일 트리를 접어 본문을 넓게
  const collapse = page.locator('[data-testid="collapse-file-tree-button"]');
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
  await page.waitForTimeout(500);
  return { ctx, page };
}

// 전: 확장 없이 사람이 렌더링 버튼을 누른 화면
{
  const { ctx, page } = await open(false);
  const file = page.locator(FILE).first();
  await file.waitFor();
  await file.locator('button[aria-pressed]').filter({ has: page.locator('svg.octicon-file') }).click();
  await file.locator('.prose-diff .markdown-body').waitFor();
  await page.waitForTimeout(800);
  await unstick(page);
  await file.screenshot({ path: join(OUT, 'before.png') });
  await ctx.close();
}

// 후: 확장이 자동으로 렌더링·접기·표 합치기
{
  const { ctx, page } = await open(true);
  const file = page.locator(FILE).first();
  await file.locator('[data-mdf="fold"]').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await unstick(page);
  await file.screenshot({ path: join(OUT, 'after.png') });
  const table = file.locator('[data-mdf="table"]');
  await table.scrollIntoViewIfNeeded();
  // 합친 표 묶음은 블록이라 폭이 꽉 찬다 — 표 크기로 줄여 찍는다
  await table.evaluate((el) => { el.style.display = 'inline-block'; });
  await table.screenshot({ path: join(OUT, 'table.png') });
  await table.evaluate((el) => { el.style.display = ''; });
  // 막대 하나 펼친 모습
  const bar = file.locator('[data-mdf="fold"]').nth(1);
  await bar.click();
  await page.waitForTimeout(400);
  await unstick(page);
  await file.screenshot({ path: join(OUT, 'after-expanded.png') });
  await bar.click();
  // 원래 표로 바꾼 모습
  await table.locator('[data-mdf-action="original"]').click();
  await page.waitForTimeout(400);
  const original = await file.evaluate((el) => {
    const wrap = el.querySelector('[data-mdf="table"]');
    const del = wrap.nextElementSibling;
    const ins = del.nextElementSibling;
    // 도구 줄(원래 표 ↔ 합친 표 버튼)부터 새 표 끝까지, 폭은 표 폭에 맞춘다
    const a = wrap.querySelector('.mdf-toolbar').getBoundingClientRect();
    const tables = [del.querySelector('table'), ins.querySelector('table')].map((t) => t.getBoundingClientRect());
    const left = Math.min(...tables.map((t) => t.left));
    const right = Math.max(...tables.map((t) => t.right)) + 4;
    const bottom = ins.getBoundingClientRect().bottom;
    return { x: left, y: a.top + window.scrollY, width: right - left, height: bottom - a.top };
  });
  await page.screenshot({ path: join(OUT, 'table-original.png'), clip: original, fullPage: true });
  await ctx.close();
}
console.log(`캡처 → ${OUT}`);

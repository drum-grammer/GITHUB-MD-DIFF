// 시연 PR 캡처: 확장 없이(전) / 확장 켜고(후) / 렌더링 보기에서 코멘트 — 파일 영역만 자른다(계정 정보가 찍히지 않게)
// 사용: node store/capture.mjs [en|ko]  (먼저 pnpm build, pnpm e2e:login으로 로그인한 테스트 프로필 필요)
// 코멘트 장면은 시연 PR에 보류 중 코멘트(나만 보임)를 올렸다가, 찍고 나면 gh로 그 리뷰를 지운다(gh 로그인 필요)
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// 시연 PR — 이 도구의 소개 문서를 1.0판에서 1.5판으로 고치는 PR(병합하지 않음). 언어마다 그 언어로 쓴 문서라 스크린샷 속 글이 그대로 도구 소개가 된다
const DEMO = {
  en: {
    pr: 'https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/34/changes',
    heading: '5.2 Comment on the rendered document',
    para: 'Hover over a block and click +',
    next: 'The comment box looks and works like',
    text: [
      'Could we add a short GIF of clicking + here? People trying it for the first time tend to miss the button.',
      "A little shorter?\n```suggestion\nThe comment box works just like GitHub's. Its first toolbar button adds a suggestion with the original lines, so the author can apply your wording in one click. Replies have the same toolbar.\n```",
    ],
  },
  ko: {
    pr: 'https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/35/changes',
    heading: '5.2 렌더링된 문서에 코멘트',
    para: '블록에 마우스를 올리고',
    next: '코멘트 상자는 GitHub 상자와',
    text: [
      '여기에 +를 누르는 짧은 GIF를 넣으면 어떨까요? 처음 쓰는 분은 버튼을 놓치기 쉬워요.',
      '조금 더 짧게 써 보면 어떨까요?\n```suggestion\n코멘트 상자는 GitHub 상자와 똑같이 동작해요. 도구 막대 첫 버튼으로 원래 줄을 담은 제안을 넣으면 작성자가 한 번에 반영해요. 답글 상자도 같아요.\n```',
    ],
  },
}[process.argv[2] ?? 'en'];
const PR = process.env.DEMO_PR ?? DEMO.pr;
const PROFILE = process.env.GMD_E2E_PROFILE ?? join(homedir(), '.cache', 'github-md-diff', 'e2e-profile');
// 확장 문구는 1.5.0부터 언어와 상관없이 영어다. 영어판은 예전처럼 한국어 문구를 뺀 사본을 올린다(맥 Chromium은 --lang을 무시한다)
const DIST = resolve(`store/build/dist-${process.argv[2] ?? 'en'}`);
rmSync(DIST, { recursive: true, force: true });
cpSync(resolve('dist'), DIST, { recursive: true });
if ((process.argv[2] ?? 'en') === 'en') rmSync(`${DIST}/_locales/ko`, { recursive: true, force: true });
const LANG = process.argv[2] ?? 'en';
const OUT = resolve(`store/build/capture/${LANG}`);
mkdirSync(OUT, { recursive: true });
const FILE = 'div[id^="diff-"][class*="Diff-module__diff__"]';
// 좁은 창에서 찍어야 글자가 커진다 — 스토어 캐러셀은 1280×800을 절반 가까이로 줄여 보여 준다
const WIDTH = Number(process.env.CAPTURE_WIDTH ?? 820);

// 파일 요소 기준 좌표(CSS px)로 본문·접기 막대·바뀐 블록을 적어 둔다 — 합성에서 강조 상자와 미니맵을 그린다
const measure = (file, name) =>
  file
    .evaluate((el) => {
      const o = el.getBoundingClientRect();
      const rel = (r) => ({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height });
      const body = el.querySelector('.prose-diff .markdown-body');
      const visible = (e) => e.getClientRects().length > 0;
      const CHANGE = 'ins, del, .added, .removed, .changed';
      const changes = [...body.children]
        .filter((c) => visible(c) && c.getAttribute('data-mdf') !== 'fold')
        .filter((c) => c.getAttribute('data-mdf') === 'table' || c.matches(CHANGE) || c.querySelector(CHANGE))
        .map((c) => rel(c.getBoundingClientRect()));
      const folds = [...body.querySelectorAll('[data-mdf="fold"]')]
        .filter(visible)
        .map((b) => ({ ...rel(b.getBoundingClientRect()), expanded: b.getAttribute('aria-expanded') === 'true', label: b.textContent.trim() }));
      return { file: { w: o.width, h: o.height }, body: rel(body.getBoundingClientRect()), changes, folds };
    })
    .then((m) => writeFileSync(join(OUT, `${name}.json`), JSON.stringify(m, null, 1)));

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
    viewport: { width: WIDTH, height: 900 },
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
  await measure(file, 'before');
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
  await measure(file, 'after');
  const table = file.locator('[data-mdf="table"]');
  await table.scrollIntoViewIfNeeded();
  // 합친 표 묶음은 블록이라 폭이 꽉 찬다 — 표 크기로 줄여 찍는다
  await table.evaluate((el) => { el.style.display = 'inline-block'; });
  await table.screenshot({ path: join(OUT, 'table.png') });
  // 행 수: GitHub의 옛 표 + 새 표 본문 행 / 합친 표에 보이는 바뀐 행
  const rows = await table.evaluate((wrap) => {
    const del = wrap.nextElementSibling;
    const ins = del.nextElementSibling;
    const body = (t) => t.querySelectorAll('tbody tr').length;
    return { original: body(del) + body(ins), merged: wrap.querySelectorAll('.mdf-row-added, .mdf-row-removed, .mdf-row-changed').length };
  });
  writeFileSync(join(OUT, 'table.json'), JSON.stringify(rows));
  await table.evaluate((el) => { el.style.display = ''; });
  // 막대 하나 펼친 모습
  const bar = file.locator('[data-mdf="fold"]').nth(1);
  await bar.click();
  await page.waitForTimeout(400);
  await unstick(page);
  await file.screenshot({ path: join(OUT, 'after-expanded.png') });
  await measure(file, 'after-expanded');
  await bar.click();
  // 원래 표로 바꾼 모습
  await table.locator('[data-mdf-action="original"]').click();
  await page.waitForTimeout(400);
  const original = await file.evaluate((el) => {
    const wrap = el.querySelector('[data-mdf="table"]');
    const del = wrap.nextElementSibling;
    const ins = del.nextElementSibling;
    // GitHub가 보여 주는 그대로(옛 표 + 새 표) — 확장의 도구 줄은 빼고, 폭은 표 폭에 맞춘다
    const a = del.getBoundingClientRect();
    const tables = [del.querySelector('table'), ins.querySelector('table')].map((t) => t.getBoundingClientRect());
    const left = Math.min(...tables.map((t) => t.left));
    const right = Math.max(...tables.map((t) => t.right)) + 4;
    const bottom = ins.getBoundingClientRect().bottom;
    return { x: left, y: a.top + window.scrollY, width: right - left, height: bottom - a.top };
  });
  await page.screenshot({ path: join(OUT, 'table-original.png'), clip: original, fullPage: true });
  await ctx.close();
}
// 코멘트: 위 문단(5.2)에 올린 보류 중 코멘트의 스레드 + 아래 문단(5.3)에 쓰는 중인 입력 상자를 한 장면으로
{
  const REPO = 'drum-grammer/GITHUB-MD-DIFF';
  const NUMBER = PR.match(/pull\/(\d+)/)[1];
  const cleanup = () => {
    const ids = execFileSync('gh', ['api', `repos/${REPO}/pulls/${NUMBER}/reviews`, '--jq', '.[] | select(.state=="PENDING") | .id'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    for (const id of ids) execFileSync('gh', ['api', '-X', 'DELETE', `repos/${REPO}/pulls/${NUMBER}/reviews/${id}`]);
  };
  const TEXT = DEMO.text;
  cleanup();
  const { ctx, page } = await open(true);
  try {
    const file = page.locator(FILE).first();
    await file.locator('[data-mdf="fold"]').first().waitFor({ timeout: 20_000 });
    await unstick(page);
    const body = file.locator('.prose-diff .markdown-body');
    const heading = file.locator('.markdown-body h3', { hasText: DEMO.heading });
    const para = file.locator('.markdown-body p', { hasText: DEMO.para });
    const plus = file.locator('[data-mdf="add-comment"]');
    const hoverPlus = async (block) => {
      for (let k = 0; k < 60 && !(await plus.isVisible()); k++) {
        await block.hover({ position: { x: 12 + (k % 5), y: 8 } });
        await page.waitForTimeout(250);
      }
    };
    await heading.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await hoverPlus(para);
    await plus.click();
    await file.locator('[data-mdf="comment-form"] textarea').fill(TEXT[0]);
    await file.locator('[data-mdf="comment-form"] .mdf-btn-primary').click(); // 리뷰 시작 — 보류 중이라 나만 보인다
    const thread = file.locator('[data-mdf="thread"]').first();
    await thread.waitFor({ timeout: 20_000 });
    // 바로 아래 문단(5.3)은 접힌 묶음 안일 수 있다 — 막대가 있으면 펼친다
    const next = file.locator('.markdown-body p', { hasText: DEMO.next });
    if (!(await next.isVisible())) {
      for (const bar of await file.locator('[data-mdf="fold"][aria-expanded="false"]').all()) {
        await bar.click();
        if (await next.isVisible()) break;
      }
    }
    await page.mouse.move(2, 2);
    await plus.waitFor({ state: 'hidden' }).catch(() => {});
    await hoverPlus(next);
    await plus.click();
    const form = file.locator('[data-mdf="comment-form"]');
    // 제안 버튼(도구 막대 맨 앞)으로 원래 줄을 넣은 뒤, 고친 문장으로 바꾼 모습
    await form.locator('.mdf-md-tool').first().click();
    await form.locator('textarea').fill(TEXT[1]);
    await form.locator('textarea').evaluate((el) => { el.style.height = `${el.scrollHeight + 4}px`; });
    await page.mouse.move(2, 2);
    await heading.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -24));
    await page.waitForTimeout(500);
    // 본문 폭으로 5.2 제목 위부터 입력 상자 아래까지. 스레드·입력 상자 위치는 잘라 낸 영역 기준 CSS px로 적는다
    const b = await body.boundingBox();
    const [h, t, f] = await Promise.all([heading.boundingBox(), thread.boundingBox(), form.boundingBox()]);
    const clip = { x: b.x - 14, y: h.y - 18, width: b.width + 28, height: f.y + f.height + 18 - (h.y - 18) };
    await page.screenshot({ path: join(OUT, 'comment.png'), clip });
    const rel = (r) => ({ x: r.x - clip.x, y: r.y - clip.y, w: r.width, h: r.height });
    writeFileSync(join(OUT, 'comment.json'), JSON.stringify({ thread: rel(t), form: rel(f) }));
  } finally {
    await ctx.close();
    cleanup();
  }
}
console.log(`캡처 → ${OUT}`);

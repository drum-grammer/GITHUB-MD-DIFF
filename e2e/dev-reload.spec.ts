import { chromium, expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 로그아웃 상태로도 content가 도는 공개 페이지
const PAGE = 'https://github.com/drum-grammer/GITHUB-MD-DIFF';

function devBuild(dir: string): string {
  execFileSync('node', ['scripts/dev-chrome.mjs', '--no-clipboard'], { env: { ...process.env, GMD_CHROME_DEV_DIR: dir }, stdio: 'ignore' });
  return (JSON.parse(readFileSync(join(dir, 'dev-build.json'), 'utf8')) as { build: string }).build;
}

test('개발 빌드는 새 빌드를 반영한 뒤 GitHub 탭 새로고침 한 번에 스스로 바뀐다', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'gmd-dev-')), 'chrome-dev');
  const first = devBuild(dir);
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gmd-dev-profile-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
  });
  try {
    // 개발자 모드가 꺼진 프로필은 reload 순간 압축해제 확장을 끈다 — 본인 크롬은 로드하려고 이미 켰다
    const ext = await context.newPage();
    await ext.goto('chrome://extensions');
    await ext.evaluate(
      () =>
        new Promise<void>((done) => {
          (globalThis as any).chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, () => done());
        }),
    );
    await ext.close();

    const page = await context.newPage();
    const running = () => page.evaluate(() => document.documentElement.dataset.gmdDevBuild ?? null);
    await page.goto(PAGE);
    await expect.poll(running).toBe(first);

    const second = devBuild(dir);
    expect(second).not.toBe(first);
    await page.reload();
    await expect.poll(running, { timeout: 20_000 }).toBe(second);

    let loads = 0;
    page.on('load', () => loads++);
    await page.reload();
    await expect.poll(running).toBe(second);
    await page.waitForTimeout(3000);
    expect(loads, '새 빌드가 돈 뒤에는 다시 로드하지 않는다').toBe(1);
  } finally {
    await context.close();
  }
});

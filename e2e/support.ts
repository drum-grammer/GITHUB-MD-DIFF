import { chromium, type BrowserContext } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** 테스트 전용 크롬 프로필 — GitHub 로그인 세션이 들어 있으므로 저장소 밖에 둔다 */
export const PROFILE = process.env.GMD_E2E_PROFILE ?? join(homedir(), '.cache', 'github-md-diff', 'e2e-profile');
export const DIST = resolve('dist');

export function launch(headless = true): Promise<BrowserContext> {
  return chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
}

/** 빈 임시 프로필 — 로그아웃 상태라 GitHub가 옛 화면(/files)을 준다(웹스토어 심사자가 볼 수 있는 화면) */
export function launchLoggedOut(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'gmd-e2e-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
}

import { chromium, type BrowserContext } from '@playwright/test';
import { homedir } from 'node:os';
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

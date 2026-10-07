import { chromium } from '@playwright/test';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PROFILE = process.env.GMD_E2E_PROFILE ?? join(homedir(), '.cache', 'github-md-diff', 'e2e-profile');
const DIST = resolve('dist');

export function launch() {
  return chromium.launchPersistentContext(PROFILE, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
}

import { chromium } from '@playwright/test';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROFILE = process.env.GMD_E2E_PROFILE ?? join(homedir(), '.cache', 'github-md-diff', 'e2e-profile');
const context = await chromium.launchPersistentContext(PROFILE, { channel: 'chromium', headless: false });
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://github.com/login');
console.log(`열린 창에서 GitHub에 로그인한 뒤 창을 닫으세요. 프로필: ${PROFILE}`);
await new Promise((done) => context.on('close', done));

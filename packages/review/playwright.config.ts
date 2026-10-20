import { defineConfig } from '@playwright/test';

// 임시 git 저장소마다 서버를 띄운다 — 한 번에 하나씩. 확장 E2E와 같은 Chromium(channel) — 확장은 싣지 않는다
export default defineConfig({ testDir: 'e2e', timeout: 90_000, workers: 1, retries: 0, reporter: 'list', use: { channel: 'chromium', headless: true } });

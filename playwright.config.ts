import { defineConfig } from '@playwright/test';

// 로그인 프로필 하나를 같이 쓰므로 한 번에 하나씩
export default defineConfig({ testDir: 'e2e', timeout: 90_000, workers: 1, retries: 0, reporter: 'list' });

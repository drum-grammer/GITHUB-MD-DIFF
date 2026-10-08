import { defineConfig } from '@playwright/test';

// pnpm testbed — 공개 테스트 저장소에서 도는 배포 전 시나리오. 로그인 프로필 하나를 같이 쓰므로 한 번에 하나씩
export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  outputDir: '../.scratch/testbed/test-results',
  reporter: [['list'], ['json', { outputFile: '../.scratch/testbed/results.json' }]],
});

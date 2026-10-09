import { defineConfig } from '@playwright/test';
import type { Layout } from './layout';

// pnpm testbed — 공개 테스트 저장소에서 도는 배포 전 시나리오. 로그인 프로필 하나를 같이 쓰므로 한 번에 하나씩.
// GitHub "Files changed" 화면 모양마다 한 프로젝트 — split은 모든 시나리오, 나머지는 @layout이 붙은 시나리오만
const others: Layout[] = ['unified', 'whitespace', 'minimized', 'compact'];
export default defineConfig<{ layout: Layout }>({
  testDir: '.',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  outputDir: '../.scratch/testbed/test-results',
  reporter: [['list'], ['json', { outputFile: '../.scratch/testbed/results.json' }]],
  projects: [{ name: 'split', use: { layout: 'split' } }, ...others.map((layout) => ({ name: layout, use: { layout }, grep: /@layout/ }))],
});

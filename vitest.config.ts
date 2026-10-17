import { defineConfig } from 'vitest/config';

// 확장 시험과 엔진 시험을 한 명령(pnpm test)으로 — 둘 다 jsdom 환경
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'extension', environment: 'jsdom', include: ['test/**/*.test.ts'] } },
      { test: { name: 'engine', environment: 'jsdom', include: ['packages/engine/test/**/*.test.ts'], testTimeout: 30_000 } },
    ],
  },
});

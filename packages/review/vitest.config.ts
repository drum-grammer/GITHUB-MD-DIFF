import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// 기본은 node 환경 — 페이지 시험만 파일 맨 위 `// @vitest-environment jsdom`
export default defineConfig({
  define: { __MDC_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: {
      'virtual:mdc-assets': here('./test/stub-assets.ts'),
      '@markdown-diff-cat/engine': here('../engine/src/index.ts'),
    },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'], testTimeout: 20_000, hookTimeout: 180_000 },
});

// 확장 빌드 한 벌 — 스토어 빌드(build.mjs·pnpm package)와 개발 빌드(pnpm dev:chrome)가 같이 쓴다
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 스토어 진입점 — 개발 전용 코드(src/dev/)는 여기서 닿지 않는다 */
export const STORE_ENTRIES = { content: 'src/content.ts', background: 'src/background.ts' };
/** 개발 진입점 — 스토어 진입점을 import하고 자기 갱신만 더한다 */
export const DEV_ENTRIES = { content: 'src/dev/content.ts', background: 'src/dev/background.ts' };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE_SRC = resolve(ROOT, 'packages/engine/src') + sep;

/**
 * 로컬 렌더링(docs/local-render §4-2) — 엔진을 브라우저에서 돌리려고 둘을 바꿔 끼운다: 엔진의 DOM 모듈(jsdom) → src/engine-dom.ts,
 * KaTeX → src/engine-math.ts(GitHub `math-renderer` 표기). 바꾼 뒤에도 둘이 번들에 들어오면 빌드를 멈춘다
 */
export const engineForBrowser = {
  name: 'engine-for-browser',
  setup(b) {
    b.onResolve({ filter: /^\.\/dom(\.ts)?$/ }, (args) => (args.importer.startsWith(ENGINE_SRC) ? { path: resolve(ROOT, 'src/engine-dom.ts') } : undefined));
    b.onResolve({ filter: /^katex$/ }, () => ({ path: resolve(ROOT, 'src/engine-math.ts') }));
  },
};

/** 콘텐츠 스크립트에 들어오면 안 되는 의존 — 페이지마다 읽히는 파일이다 */
const FORBIDDEN = /(?:^|[\\/])node_modules[\\/](?:\.pnpm[\\/])?(?:jsdom|katex)[@\\/]/;

/**
 * outdir을 비우고 진입점을 묶은 뒤 static/·styles.css를 복사한다
 * @param {{ outdir: string, entries?: Record<string, string>, define?: Record<string, string>, logLevel?: import('esbuild').LogLevel }} options
 */
export async function bundle({ outdir, entries = STORE_ENTRIES, define = {}, logLevel = 'info' }) {
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  const result = await build({ entryPoints: entries, bundle: true, format: 'iife', target: 'chrome120', outdir, logLevel, define, plugins: [engineForBrowser], metafile: true });
  const leaked = Object.keys(result.metafile.inputs).filter((p) => FORBIDDEN.test(p));
  if (leaked.length) throw new Error(`확장 번들에 들어오면 안 되는 의존: ${leaked.slice(0, 3).join(', ')}`);
  cpSync('static', outdir, { recursive: true });
  cpSync('src/styles.css', `${outdir}/styles.css`);
}

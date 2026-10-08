// 확장 빌드 한 벌 — 스토어 빌드(build.mjs·pnpm package)와 개발 빌드(pnpm dev:chrome)가 같이 쓴다
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

/** 스토어 진입점 — 개발 전용 코드(src/dev/)는 여기서 닿지 않는다 */
export const STORE_ENTRIES = { content: 'src/content.ts', background: 'src/background.ts' };
/** 개발 진입점 — 스토어 진입점을 import하고 자기 갱신만 더한다 */
export const DEV_ENTRIES = { content: 'src/dev/content.ts', background: 'src/dev/background.ts' };

/**
 * outdir을 비우고 진입점을 묶은 뒤 static/·styles.css를 복사한다
 * @param {{ outdir: string, entries?: Record<string, string>, define?: Record<string, string>, logLevel?: import('esbuild').LogLevel }} options
 */
export async function bundle({ outdir, entries = STORE_ENTRIES, define = {}, logLevel = 'info' }) {
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  await build({ entryPoints: entries, bundle: true, format: 'iife', target: 'chrome120', outdir, logLevel, define });
  cpSync('static', outdir, { recursive: true });
  cpSync('src/styles.css', `${outdir}/styles.css`);
}

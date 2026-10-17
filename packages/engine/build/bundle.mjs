// 엔진을 Node 22용 ESM 파일 하나로 묶는다 — 패리티 스크립트와 M2 CLI 빌드가 같이 쓴다.
// jsdom은 실행 중 파일 둘을 찾는다: 기본 스타일시트(읽음)와 동기 XHR 작업자(경로만). 묶은 파일 하나로 돌도록 둘 다 번들 안에서 해결한다
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** jsdom이 실행 중 읽는 파일을 번들 안 글자로 바꾼다(2026-10-16 jsdom 30.1 기준 두 곳) */
export const inlineJsdomFiles = {
  name: 'inline-jsdom-files',
  setup(b) {
    const jsdomDir = dirname(require.resolve('jsdom/package.json'));
    b.onLoad({ filter: /jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]css[\\/]helpers[\\/]computed-style\.js$/ }, (args) => {
      const css = readFileSync(join(jsdomDir, 'lib/jsdom/browser/default-stylesheet.css'), 'utf8');
      const src = readFileSync(args.path, 'utf8');
      const out = src.replace(/fs\.readFileSync\(\s*path\.resolve\(__dirname, "\.\.\/\.\.\/\.\.\/browser\/default-stylesheet\.css"\),\s*\{ encoding: "utf-8" \}\s*\)/, () => JSON.stringify(css));
      if (out === src) throw new Error('jsdom computed-style.js 모양이 바뀜 — inlineJsdomFiles를 고칠 것');
      return { contents: out, loader: 'js' };
    });
    b.onLoad({ filter: /jsdom[\\/]lib[\\/]jsdom[\\/]living[\\/]xhr[\\/]XMLHttpRequest-impl\.js$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      const out = src.replace('require.resolve("./xhr-sync-worker.js")', '"xhr-sync-worker-unavailable"');
      if (out === src) throw new Error('jsdom XMLHttpRequest-impl.js 모양이 바뀜 — inlineJsdomFiles를 고칠 것');
      return { contents: out, loader: 'js' };
    });
  },
};

/** CJS로 쓰인 의존(jsdom 등)이 ESM 번들 안에서 require·__dirname을 찾게 */
const BANNER = "import { createRequire as __mdcRequire } from 'node:module'; import { fileURLToPath as __mdcPath } from 'node:url'; import { dirname as __mdcDir } from 'node:path'; const require = __mdcRequire(import.meta.url); const __filename = __mdcPath(import.meta.url); const __dirname = __mdcDir(__filename);";

/**
 * @param {{ entry: string, outfile: string, minify?: boolean }} options
 */
export async function bundleEngine({ entry, outfile, minify = false }) {
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile,
    minify,
    external: ['canvas'],
    plugins: [inlineJsdomFiles],
    banner: { js: BANNER },
    logLevel: 'silent',
  });
}

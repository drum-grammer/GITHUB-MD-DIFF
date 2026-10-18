// Node 22 단일 파일 dist/markdown-diff-cat.mjs와 자산 목록 dist/assets.json을 만든다
// 자산은 빌드 때 base64로 묶고, 서버가 /assets/*로 풀어 낸다. 런타임 의존은 없다(모두 번들)
import { build } from 'esbuild';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { entry, licenseText, packageRoots, TEXT } from './scripts/build-assets.mjs';
// jsdom이 실행 중 찾는 파일 둘을 번들 안에서 해결한다(M1 Task 13)
import { inlineJsdomFiles } from '../engine/build/bundle.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const OUT = 'dist/markdown-diff-cat.mjs';

/** virtual:mdc-assets를 주어진 표로 채우는 esbuild 플러그인 */
function assetsPlugin(table) {
  return {
    name: 'mdc-assets',
    setup(b) {
      b.onResolve({ filter: /^virtual:mdc-assets$/ }, () => ({ path: 'mdc-assets', namespace: 'mdc' }));
      b.onLoad({ filter: /.*/, namespace: 'mdc' }, () => ({ contents: `export default ${JSON.stringify(table)};`, loader: 'js' }));
    },
  };
}

const node = {
  entryPoints: ['src/bin.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  // 묶은 CommonJS 의존(jsdom 등)이 ESM 번들 안에서 require·__dirname을 찾게 — M1 엔진 번들(packages/engine/build/bundle.mjs)과 같은 머리
  banner: { js: "import { createRequire as __mdcRequire } from 'node:module'; import { fileURLToPath as __mdcPath } from 'node:url'; import { dirname as __mdcDir } from 'node:path'; const require = __mdcRequire(import.meta.url); const __filename = __mdcPath(import.meta.url); const __dirname = __mdcDir(__filename);" },
  // jsdom의 선택 의존(안 씀)
  external: ['canvas'],
  define: { __MDC_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
};

// 1차: 자산 없이 묶어 어떤 서드파티 패키지가 들어가는지 본다(라이선스 고지)
const probe = await build({ ...node, write: false, metafile: true, plugins: [inlineJsdomFiles, assetsPlugin({})] });
const roots = packageRoots(probe.metafile, process.cwd());

const table = {
  'skill.md.tmpl': entry(TEXT['.tmpl'], readFileSync('../../skills/markdown-diff-review/SKILL.md.tmpl')),
  'licenses.txt': entry(TEXT['.txt'], Buffer.from([readFileSync('LICENSE', 'utf8').trim(), ...roots.map(licenseText)].join('\n\n'))),
};

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
await build({ ...node, outfile: OUT, plugins: [inlineJsdomFiles, assetsPlugin(table)] });
chmodSync(OUT, 0o755);
writeFileSync('dist/assets.json', `${JSON.stringify(Object.fromEntries(Object.entries(table).map(([k, v]) => [k, { type: v.type, bytes: v.bytes }])), null, 2)}\n`);
console.log(`${OUT} ${(readFileSync(OUT).length / 1024 / 1024).toFixed(2)} MB · assets ${Object.keys(table).length}`);

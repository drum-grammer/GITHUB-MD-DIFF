// Node 22 단일 파일 dist/markdown-diff-cat.mjs와 자산 목록 dist/assets.json을 만든다
// 페이지 번들·CSS·KaTeX 폰트·mermaid·skill 템플릿·라이선스는 빌드 때 base64로 묶고, 서버가 /assets/*로 풀어 낸다(스펙 §5-7)
import { build } from 'esbuild';
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { entry, katexCss, licenseText, packageRoot, packageRoots, TEXT, withDependencies } from './scripts/build-assets.mjs';
// jsdom이 실행 중 찾는 파일 둘을 번들 안에서 해결한다(M1 Task 13)
import { inlineJsdomFiles } from '../engine/build/bundle.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const OUT = 'dist/markdown-diff-cat.mjs';
const require = createRequire(import.meta.url);
const OCTICONS = '== Primer Octicons 19.40.0 (comment toolbar icon paths) ==\nMIT License, Copyright (c) GitHub Inc.';

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

// 1차: 자산 없이 묶어 들어가는 서드파티 패키지를 본다 — 라이선스 고지와, 엔진이 쓰는 KaTeX 판(CSS·폰트를 같은 판으로)
// session.ts(Task 9)는 엔진을 import한다 — cli.ts가 아직 잇지 않은 Task 15에서도 KaTeX 판·라이선스를 찾게 둘째 입구로 본다
const probe = await build({ ...node, entryPoints: ['src/bin.ts', 'src/session.ts'], outdir: 'dist', write: false, metafile: true, plugins: [inlineJsdomFiles, assetsPlugin({})] });
const roots = packageRoots(probe.metafile, process.cwd());
const katexRoot = packageRoot(roots, 'katex');
if (!katexRoot) throw new Error('the engine bundle has no katex — cannot match the KaTeX CSS and fonts to its version');

// 페이지 번들(브라우저, 확장과 같은 대상)
const page = await build({ entryPoints: ['src/page/main.ts'], bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', minify: true, write: false, metafile: true, logLevel: 'warning' });
const pageRoots = packageRoots(page.metafile, process.cwd());

const markdownCssRoot = dirname(require.resolve('github-markdown-css/package.json'));
const mermaidRoot = dirname(require.resolve('mermaid/package.json'));
const css = [
  readFileSync(join(markdownCssRoot, 'github-markdown.css'), 'utf8'),
  readFileSync('src/page/tokens.css', 'utf8'),
  readFileSync('src/page/rich-diff.css', 'utf8'),
  readFileSync('../../src/styles.css', 'utf8'),
  readFileSync('src/page/page.css', 'utf8'),
].join('\n');
const katex = katexCss(readFileSync(join(katexRoot, 'dist', 'katex.min.css'), 'utf8'));
const fonts = readdirSync(join(katexRoot, 'dist', 'fonts')).filter((f) => f.endsWith('.woff2'));
for (const [, ref] of katex.matchAll(/url\((fonts\/[^)]+)\)/g)) {
  if (!fonts.includes(ref.slice('fonts/'.length))) throw new Error(`katex.css refers to ${ref}, which is not a bundled woff2 font`);
}
const third = [...new Set([...roots, ...pageRoots, katexRoot, markdownCssRoot, ...withDependencies(mermaidRoot)])].sort();
const licenses = [readFileSync('LICENSE', 'utf8').trim(), OCTICONS, ...third.map(licenseText)].join('\n\n');

const table = {
  'page.js': entry(TEXT['.js'], page.outputFiles[0].contents),
  'page.css': entry(TEXT['.css'], Buffer.from(css)),
  'katex.css': entry(TEXT['.css'], Buffer.from(katex)),
  ...Object.fromEntries(fonts.map((f) => [`fonts/${f}`, entry(TEXT['.woff2'], readFileSync(join(katexRoot, 'dist', 'fonts', f)))])),
  'mermaid.js': entry(TEXT['.js'], readFileSync(join(mermaidRoot, 'dist', 'mermaid.min.js'))),
  'skill.md.tmpl': entry(TEXT['.tmpl'], readFileSync('../../skills/markdown-diff-review/SKILL.md.tmpl')),
  'licenses.txt': entry(TEXT['.txt'], Buffer.from(licenses)),
};

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
await build({ ...node, outfile: OUT, plugins: [inlineJsdomFiles, assetsPlugin(table)] });
chmodSync(OUT, 0o755);
writeFileSync('dist/assets.json', `${JSON.stringify(Object.fromEntries(Object.entries(table).map(([k, v]) => [k, { type: v.type, bytes: v.bytes }])), null, 2)}\n`);
// 시험용 사본(npm 패키지에는 싣지 않는다 — files는 dist/markdown-diff-cat.mjs뿐)
writeFileSync('dist/licenses-check.txt', licenses);
console.log(`${OUT} ${(readFileSync(OUT).length / 1024 / 1024).toFixed(2)} MB · assets ${Object.keys(table).length}`);

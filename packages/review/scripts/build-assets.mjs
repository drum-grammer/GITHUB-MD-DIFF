// 자산 표 한 칸 만들기와 번들에 든 서드파티 패키지 찾기 — build.mjs가 쓴다(입출력은 파일 읽기뿐)
import { brotliCompressSync, constants } from 'node:zlib';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export const TEXT = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.tmpl': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** 자산 하나 → 표 한 칸. woff2는 이미 압축돼 있어 그대로, 나머지는 브로틀리(품질 9 — 11은 mermaid에서 10초가 넘는다) */
export function entry(type, data) {
  const buf = Buffer.from(data);
  if (type === TEXT['.woff2']) return { type, br: false, b64: buf.toString('base64'), bytes: buf.length };
  const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } });
  return { type, br: true, b64: br.toString('base64'), bytes: buf.length };
}

/** esbuild metafile의 입력 경로 중 node_modules 아래 것 → 패키지 뿌리(절대 경로, 겹침 없이) */
export function packageRoots(metafile, cwd) {
  const roots = new Set();
  const marker = `${sep}node_modules${sep}`;
  for (const input of Object.keys(metafile.inputs)) {
    const abs = resolve(cwd, input);
    const i = abs.lastIndexOf(marker);
    if (i < 0) continue;
    const rest = abs.slice(i + marker.length).split(sep);
    const name = rest[0].startsWith('@') ? `${rest[0]}${sep}${rest[1]}` : rest[0];
    roots.add(realpathSync(join(abs.slice(0, i), 'node_modules', name)));
  }
  return [...roots].sort();
}

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'LICENCE', 'COPYING'];

/** 패키지 하나의 라이선스 고지 — 원문 파일이 없으면 package.json의 license 값만 적는다 */
export function licenseText(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const file = LICENSE_FILES.map((f) => join(root, f)).find((f) => existsSync(f));
  const body = file ? readFileSync(file, 'utf8').trim() : `License: ${pkg.license ?? 'unknown'}`;
  return `== ${pkg.name}@${pkg.version} ==\n${body}`;
}

/** 패키지 뿌리 목록에서 이름이 name인 것 */
export function packageRoot(roots, name) {
  return roots.find((r) => r.endsWith(`${sep}node_modules${sep}${name.split('/').join(sep)}`)) ?? null;
}

/** node 해석 규칙대로 위로 올라가며 <dir>/node_modules/<dep>를 찾는다(pnpm은 의존을 형제 폴더에 둔다) */
function findDependency(fromRoot, dep) {
  for (let dir = fromRoot; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', dep);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(dir) === dir) return null;
  }
}

/** 패키지와 그 production 의존 전부(라이선스 고지용) — mermaid.min.js처럼 의존을 안에 묶어 낸 배포물 */
export function withDependencies(root) {
  const seen = new Set();
  const queue = [realpathSync(root)];
  while (queue.length) {
    const dir = queue.shift();
    if (seen.has(dir)) continue;
    seen.add(dir);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      const found = findDependency(dir, dep);
      if (found) queue.push(found);
    }
  }
  return [...seen].sort();
}

/** KaTeX CSS — woff2만 싣으므로 woff·ttf 대체 주소는 지운다(없는 주소 요청이 나가지 않게) */
export function katexCss(css) {
  return css.replace(/,url\(fonts\/[^)]+\.woff\) format\("woff"\)/g, '').replace(/,url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g, '');
}

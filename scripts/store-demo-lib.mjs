// 시연 PR 기록(store/demos/<버전>/) 읽기·검사·브랜치 계획 — 화면·git·네트워크는 모른다(store-demo.mjs·capture.mjs가 쓴다)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEMOS_DIR = 'store/demos';
export const LANGS = ['en', 'ko'];
const REPO = 'drum-grammer/GITHUB-MD-DIFF';

/** v1.5.0 → [1, 5, 0]. 버전 폴더가 아니면 null */
export function parseVersionDir(name) {
  const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(name);
  return m ? m.slice(1).map(Number) : null;
}

/** 버전 폴더 이름들 중 가장 높은 것 */
export function latestVersion(names) {
  const versions = names.map((n) => [n, parseVersionDir(n)]).filter(([, v]) => v);
  versions.sort(([, a], [, b]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return versions.length ? versions[versions.length - 1][0] : null;
}

export function listDemos(root = DEMOS_DIR) {
  return existsSync(root) ? readdirSync(root).filter((n) => parseVersionDir(n)) : [];
}

export function loadDemo(dir, root = DEMOS_DIR) {
  return JSON.parse(readFileSync(join(root, dir, 'demo.json'), 'utf8'));
}

/** 이 버전 폴더의 문제 — 빠진 칸·파일, 같은 base/head, 캡처가 찾는 글이 head 문서에 없음 */
export function checkDemo(dir, root = DEMOS_DIR) {
  const problems = [];
  let demo;
  try {
    demo = loadDemo(dir, root);
  } catch (e) {
    return [`${dir}: demo.json을 읽지 못했다 — ${e.message}`];
  }
  if (`v${demo.version}` !== dir) problems.push(`${dir}: version ${demo.version}이 폴더 이름과 다르다`);
  for (const key of ['about', 'baseBranch', 'langs']) if (!demo[key]) problems.push(`${dir}: ${key}가 없다`);
  for (const lang of LANGS) {
    const d = demo.langs?.[lang];
    if (!d) {
      problems.push(`${dir}: ${lang}이 없다`);
      continue;
    }
    for (const key of ['path', 'base', 'head', 'heading', 'para', 'next']) if (!d[key]) problems.push(`${dir}/${lang}: ${key}가 없다`);
    if (!Array.isArray(d.comments) || d.comments.length !== 2) problems.push(`${dir}/${lang}: comments는 2개(스레드·입력 상자)`);
    const read = (f) => (f && existsSync(join(root, dir, f)) ? readFileSync(join(root, dir, f), 'utf8') : null);
    const base = read(d.base);
    const head = read(d.head);
    if (base === null) problems.push(`${dir}/${lang}: base 파일 ${d.base}가 없다`);
    if (head === null) problems.push(`${dir}/${lang}: head 파일 ${d.head}가 없다`);
    if (base !== null && head !== null && base === head) problems.push(`${dir}/${lang}: base와 head가 같다 — 바뀐 곳이 없으면 시연이 안 된다`);
    if (head !== null) for (const key of ['heading', 'para', 'next']) if (d[key] && !head.includes(d[key])) problems.push(`${dir}/${lang}: ${key} "${d[key]}"가 head 문서에 없다`);
  }
  return problems;
}

/** 새 시연에 쓸 브랜치 이름 — 버전마다 새로 만들어 예전 시연을 덮지 않는다 */
export function branchPlan(version, langs = LANGS) {
  const v = version.replace(/^v/, '');
  return { base: `demo/v${v}/base`, heads: Object.fromEntries(langs.map((l) => [l, `demo/v${v}/${l}`])) };
}

/** 캡처가 여는 주소 */
export function prUrl(pr) {
  return `https://github.com/${REPO}/pull/${pr}/changes`;
}

// 써 보기 하네스의 순수 부분 — 고정 폴더·빌드 번호·개발 매니페스트·폴더 반영
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const DEV_NAME = 'Markdown Diff Cat (dev)';
/** 자기 갱신(src/dev/background.ts)이 읽는 파일 — 맨 마지막에 쓴다 */
export const BUILD_FILE = 'dev-build.json';

/** 크롬이 읽는 고정 폴더. 압축해제 확장 ID는 경로로 정해지므로 늘 같은 곳. ~/.cache는 저장공간 정리 대상이라 피한다 */
export function devDir(env, home) {
  // resolve가 끝 슬래시를 떼어 준다 — 스테이징 폴더(<폴더>.next)가 반영할 폴더 안에 생기지 않게
  return resolve(env.GMD_CHROME_DEV_DIR || join(home, '.local', 'share', 'github-md-diff', 'chrome-dev'));
}

/** 반영할 폴더가 개발 빌드 폴더인지 — 비어 있지 않은데 빌드 번호 파일도, 개발 매니페스트도 없으면 남의 폴더다(syncDir는 모르는 파일을 지운다) */
export function devDirProblem(dir) {
  if (!existsSync(dir) || readdirSync(dir).length === 0) return null;
  if (existsSync(join(dir, BUILD_FILE))) return null;
  try {
    if (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).name === DEV_NAME) return null;
  } catch {
    // 매니페스트가 없거나 읽을 수 없다
  }
  return `${dir}는 비어 있지 않고 개발 빌드 폴더가 아니다 — 안의 파일을 지우게 되므로 멈춘다. GMD_CHROME_DEV_DIR로 빈 폴더나 새 경로를 준다`;
}

/** 빌드마다 달라지는 번호 — 같은 커밋을 연달아 빌드해도 다르게 밀리초(36진수)를 붙인다 */
export function devBuildId({ version, sha, dirty, now }) {
  return `${version}+${sha}${dirty ? '.dirty' : ''}.${now.getTime().toString(36)}`;
}

/** 스토어 매니페스트 → 개발 매니페스트. 이름으로 스토어판과 구별하고 카드에 커밋이 보이게 한다. 권한·매치는 그대로 */
export function devManifest(manifest, { sha, dirty }) {
  return {
    ...manifest,
    name: DEV_NAME,
    version_name: `${manifest.version} dev ${sha}${dirty ? ' dirty' : ''}`,
    action: { ...manifest.action, default_title: DEV_NAME },
  };
}

function filesUnder(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? filesUnder(root, p) : [relative(root, p)];
  });
}

function removeEmptyDirs(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = join(dir, e.name);
    removeEmptyDirs(p);
    if (readdirSync(p).length === 0) rmdirSync(p);
  }
}

/**
 * to를 from과 같게 — BUILD_FILE을 먼저 지우고, 새 파일로 덮어쓰고, from에 없는 옛 파일을 지우고, BUILD_FILE을 맨 마지막에 쓴다.
 * 자기 갱신은 BUILD_FILE을 보고 시작하므로, 복사 중이거나 중간에 실패한 폴더에서는 다시 로드하지 않는다
 * @param {string} from @param {string} to @param {(rel: string) => void} [onCopy]
 */
export function syncDir(from, to, onCopy = () => {}) {
  mkdirSync(to, { recursive: true });
  rmSync(join(to, BUILD_FILE), { force: true });
  const next = filesUnder(from);
  const copy = (rel) => {
    mkdirSync(dirname(join(to, rel)), { recursive: true });
    copyFileSync(join(from, rel), join(to, rel));
    onCopy(rel);
  };
  for (const rel of next) if (rel !== BUILD_FILE) copy(rel);
  const keep = new Set(next);
  for (const rel of filesUnder(to)) if (!keep.has(rel)) rmSync(join(to, rel));
  removeEmptyDirs(to);
  if (keep.has(BUILD_FILE)) copy(BUILD_FILE);
}

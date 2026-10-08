// 써 보기 하네스(pnpm dev:chrome) — 스토어 심사 전 빌드를 내 크롬에서 쓴다.
// 개발 빌드를 고정 폴더에 반영한다. 처음 한 번 그 폴더를 크롬에 압축해제 로드하면, 그 뒤로는 어느 브랜치·worktree에서든
// 이 명령 → GitHub 탭 새로고침 한 번이면 확장이 스스로 새 빌드로 바뀐다(src/dev/). 스토어 빌드에는 이 코드가 없다
// 옵션: --open(크롬에 chrome://extensions 탭) · --no-clipboard · 폴더는 GMD_CHROME_DEV_DIR로 바꾼다
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEV_ENTRIES, bundle } from './build-lib.mjs';
import { BUILD_FILE, devBuildId, devDir, devDirProblem, devManifest, syncDir } from './dev-chrome-lib.mjs';

const args = new Set(process.argv.slice(2));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const target = devDir(process.env, homedir());
const problem = devDirProblem(target);
if (problem) {
  console.error(`멈춤: ${problem}`);
  process.exit(1);
}
const next = `${target}.next`;
const sha = git('rev-parse', '--short', 'HEAD');
const dirty = git('status', '--porcelain') !== '';
const { version } = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
const build = devBuildId({ version, sha, dirty, now: new Date() });

await bundle({ outdir: next, entries: DEV_ENTRIES, define: { __DEV_BUILD__: JSON.stringify(build) }, logLevel: 'warning' });
const manifestPath = join(next, 'manifest.json');
writeFileSync(manifestPath, `${JSON.stringify(devManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), { sha, dirty }), null, 2)}\n`);
writeFileSync(join(next, BUILD_FILE), `${JSON.stringify({ build })}\n`);
syncDir(next, target);
rmSync(next, { recursive: true, force: true });

let copied = false;
if (!args.has('--no-clipboard') && process.platform === 'darwin') {
  try {
    execFileSync('pbcopy', { input: target });
    copied = true;
  } catch {
    // 클립보드가 없어도 안내는 한다
  }
}
if (args.has('--open')) {
  try {
    // open -a는 Launch Services로 넘긴다 — osascript와 달리 자동화(손쉬운 사용) 권한을 묻지 않는다
    execFileSync('open', ['-a', 'Google Chrome', 'chrome://extensions/'], { stdio: 'ignore' });
  } catch {
    console.log('크롬에서 chrome://extensions 를 직접 연다');
  }
}
console.log(`
Markdown Diff Cat (dev) ${version} dev ${sha}${dirty ? ' dirty' : ''} → ${target}${copied ? '  (경로를 클립보드에 복사함)' : ''}
처음이면: chrome://extensions → 개발자 모드 켜기 → 압축해제된 확장 프로그램 로드 → Cmd+Shift+G로 위 경로 붙여 넣기 → 선택.
          스토어판 Markdown Diff Cat for GitHub는 꺼 둔다(둘 다 켜면 같은 화면을 둘이 고친다).
이미 올렸으면: GitHub 탭을 새로고침하면 새 빌드로 바뀐다.`);

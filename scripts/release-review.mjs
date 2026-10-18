// npm 패키지 markdown-diff-cat 릴리스 — node scripts/release-review.mjs <check | attach --confirm X.Y.Z | publish --confirm X.Y.Z>
// 확장 pnpm release finish가 vX.Y.Z GitHub Release를 만든 뒤 이어 받는다(확장 하네스 scripts/release.mjs는 고치지 않는다).
// check: 확장 릴리스 커밋(태그)·깨끗한 트리·세 버전·시험·빌드·게시용 폴더·npm pack 목록·크기·의존 0·npm에 그 버전이 없음 → 기록
// attach: 같은 Release에 단일 파일(markdown-diff-cat-X.Y.Z.mjs) — 채팅 확인 뒤
// publish: npm publish <게시용 폴더> — 사람이 자기 터미널에서(OTP는 사람). 채팅 확인 뒤
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { releaseDir } from './release-lib.mjs';
import { BUILT, PKG_DIR, assetName, attachGate, commitGate, manifestProblems, npmGate, npmReadme, packProblems, parseReviewArgs, publishGate, publishManifest, versionsProblems } from './release-review-lib.mjs';

// 자식 프로세스에는 스토어 키를 넘기지 않는다(확장 하네스와 같은 규칙)
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CWS_')));
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: childEnv, ...opts }).trim();
const git = (...a) => sh('git', a);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const version = () => readJson(`${PKG_DIR}/package.json`).version;

function paths(v) {
  const dir = releaseDir(process.env, homedir(), v);
  return { dir, record: join(dir, 'review.json'), stage: join(dir, 'npm'), asset: join(dir, assetName(v)) };
}
const readRecord = (v) => (existsSync(paths(v).record) ? readJson(paths(v).record) : null);
function writeRecord(r) {
  mkdirSync(paths(r.version).dir, { recursive: true });
  writeFileSync(paths(r.version).record, `${JSON.stringify(r, null, 2)}\n`);
}

function fail(message) {
  console.error(`멈춤: ${message}`);
  process.exit(1);
}

function run(cmd, ...args) {
  try {
    execFileSync(cmd, args, { stdio: 'inherit', env: childEnv });
  } catch {
    fail(`${cmd} ${args.join(' ')} 실패`);
  }
}

/** npm에 이미 있는 버전들 — 아직 한 번도 안 냈으면(E404) 빈 목록 */
function publishedVersions() {
  try {
    const out = sh('npm', ['view', 'markdown-diff-cat', 'versions', '--json']);
    const parsed = JSON.parse(out || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    // --json이면 오류가 stdout(JSON)으로, 아니면 stderr로 나온다 — 둘 다 본다
    const said = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`;
    if (said.includes('E404')) return [];
    fail(`npm view 실패 — ${said.trim()}`);
  }
}

async function check() {
  git('fetch', 'origin', '--tags', '--quiet');
  const head = git('rev-parse', 'HEAD');
  // 확장 pnpm release check가 남긴 기록의 commit = finish가 태그 vX.Y.Z를 단 커밋. 노트 PR이 그 뒤 main에 병합돼 있어도 그 커밋에서 빌드한다
  const extRecord = join(releaseDir(process.env, homedir(), version()), 'record.json');
  const releaseCommit = existsSync(extRecord) ? readJson(extRecord).commit : null;
  const tree = commitGate({ head, releaseCommit, porcelain: git('status', '--porcelain') });
  if (tree) fail(tree);
  const v = version();
  const versions = versionsProblems({ root: readJson('package.json').version, manifest: readJson('static/manifest.json').version, review: v });
  const pkg = readJson(`${PKG_DIR}/package.json`);
  const problems = [...versions, ...manifestProblems(pkg)];
  if (problems.length) fail(problems.join('\n'));
  const gate = npmGate({ version: v, published: publishedVersions() });
  if (gate) fail(gate);
  run('pnpm', '--filter', 'markdown-diff-cat', 'typecheck');
  run('pnpm', '--filter', 'markdown-diff-cat', 'test');
  run('pnpm', '--filter', 'markdown-diff-cat', 'build');
  if (git('status', '--porcelain') !== '') fail('점검하는 동안 파일이 바뀌었다 — check를 다시');
  const p = paths(v);
  rmSync(p.stage, { recursive: true, force: true });
  mkdirSync(join(p.stage, 'dist'), { recursive: true });
  copyFileSync(BUILT, join(p.stage, 'dist', 'markdown-diff-cat.mjs'));
  writeFileSync(join(p.stage, 'README.md'), npmReadme(readFileSync(`${PKG_DIR}/README.md`, 'utf8')));
  copyFileSync(`${PKG_DIR}/LICENSE`, join(p.stage, 'LICENSE'));
  writeFileSync(join(p.stage, 'package.json'), `${JSON.stringify(publishManifest(pkg), null, 2)}\n`);
  const pack = JSON.parse(sh('npm', ['pack', '--dry-run', '--json'], { cwd: p.stage }))[0];
  const packed = packProblems(pack);
  if (packed.length) fail(packed.join('\n'));
  const record = { version: v, commit: head, sha256: sha256(BUILT), size: statSync(BUILT).size, stage: p.stage, checkedAt: new Date().toISOString() };
  writeRecord(record);
  console.log(`점검 통과 — markdown-diff-cat ${v} · 커밋 ${head.slice(0, 7)} · ${(record.size / 1024 / 1024).toFixed(2)} MB · SHA-256 ${record.sha256}
게시용 폴더: ${p.stage}
다음: (확장 pnpm release finish로 v${v} Release가 생긴 뒤) node scripts/release-review.mjs attach --confirm ${v}`);
}

async function attach({ confirm }) {
  const v = version();
  const record = readRecord(v);
  let releaseExists = true;
  let assets = [];
  try {
    assets = JSON.parse(sh('gh', ['release', 'view', `v${v}`, '--json', 'assets'])).assets.map((a) => a.name);
  } catch {
    releaseExists = false;
  }
  const gate = attachGate(record, { confirm, builtSha: existsSync(BUILT) ? sha256(BUILT) : '', releaseExists, assets });
  if (gate) fail(gate);
  const p = paths(v);
  copyFileSync(BUILT, p.asset);
  run('gh', 'release', 'upload', `v${v}`, p.asset);
  record.attach = { at: new Date().toISOString(), asset: assetName(v) };
  writeRecord(record);
  console.log(`v${v} Release에 ${assetName(v)}를 붙였다
다음(사람이 자기 터미널에서, OTP는 사람): node scripts/release-review.mjs publish --confirm ${v}`);
}

async function publish({ confirm }) {
  const v = version();
  const record = readRecord(v);
  const stagedFile = join(paths(v).stage, 'dist', 'markdown-diff-cat.mjs');
  const gate = publishGate(record, { confirm, builtSha: existsSync(BUILT) ? sha256(BUILT) : '', stagedSha: existsSync(stagedFile) ? sha256(stagedFile) : '', published: publishedVersions() });
  if (gate) fail(gate);
  try {
    sh('npm', ['whoami']);
  } catch {
    fail('npm에 로그인돼 있지 않다 — 사람이 npm login을 먼저 한다');
  }
  run('npm', 'publish', paths(v).stage, '--access', 'public');
  if (!publishedVersions().includes(v)) console.log(`⚠\uFE0F npm view에 아직 ${v}이 안 보인다 — 몇 분 뒤 npm view markdown-diff-cat versions로 다시 본다`);
  record.publish = { at: new Date().toISOString() };
  writeRecord(record);
  console.log(`npm에 markdown-diff-cat@${v} 게시 — 확인: npx -y markdown-diff-cat@${v} --version`);
}

const opts = parseReviewArgs(process.argv.slice(2));
const steps = { check, attach, publish };
const step = steps[opts.step];
if (!step) fail('단계: check | attach --confirm X.Y.Z | publish --confirm X.Y.Z');
await step(opts);

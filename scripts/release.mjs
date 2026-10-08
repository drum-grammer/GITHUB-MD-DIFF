// 스토어 업데이트 하네스 — pnpm release <check|upload|submit|status|notes|finish>
// check(점검·패키지·기록) → upload(초안, 비공개) → submit --confirm X.Y.Z(심사 제출, 승인되면 자동 게시) → status
// → notes(릴리스 노트 초안) → finish --confirm X.Y.Z(태그·GitHub Release)
// 기록·올린 zip·노트는 저장소 밖 ~/.local/share/github-md-diff/releases/<버전>/ — 심사가 끝난 뒤 다른 세션의 finish가 그대로 쓴다
// 키: CWS_SERVICE_ACCOUNT_KEY(서비스 계정 JSON 키 전체). 없으면 check·status는 스토어 부분을 미확인으로 두고, upload·submit·finish는 멈춘다
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CwsError, accessToken, createClient, publishedVersion, summarizeStatus, waitForUpload } from './cws.mjs';
import {
  checkGate,
  finishGate,
  latestVersionTag,
  notesDraft,
  notesProblem,
  parseArgs,
  releaseDir,
  submissionWhat,
  submitGate,
  tagPlan,
  treeProblems,
  uploadGate,
  versionProblems,
  zipName,
} from './release-lib.mjs';
import { compareListing, textsFrom } from './store-texts.mjs';

const KEY_HINT = '서비스 계정 키가 필요하다 — 환경변수 CWS_SERVICE_ACCOUNT_KEY(JSON 키 전체). 설정: store/README.md "Releasing an update"';
// 자식 프로세스(테스트·e2e·브라우저·git·gh)에는 스토어 키를 넘기지 않는다
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CWS_')));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: childEnv }).trim();
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const currentVersion = () => readJson('static/manifest.json').version;
const tags = () => git('tag', '--list', 'v*').split('\n').filter(Boolean);

/** 버전별 기록 폴더의 파일들 */
function paths(version) {
  const dir = releaseDir(process.env, homedir(), version);
  return { dir, record: join(dir, 'record.json'), zip: join(dir, zipName(version)), notes: join(dir, 'notes.md') };
}
const readRecord = (v) => (existsSync(paths(v).record) ? readJson(paths(v).record) : null);
const zipSha = (v) => (existsSync(paths(v).zip) ? sha256(paths(v).zip) : '');
function writeRecord(r) {
  mkdirSync(paths(r.version).dir, { recursive: true });
  writeFileSync(paths(r.version).record, `${JSON.stringify(r, null, 2)}\n`);
}

function fail(message) {
  console.error(`멈춤: ${message}`);
  process.exit(1);
}

function run(cmd, ...a) {
  try {
    execFileSync(cmd, a, { stdio: 'inherit', env: childEnv });
  } catch {
    fail(`${cmd} ${a.join(' ')} 실패`);
  }
}

async function store({ required }) {
  let token = null;
  try {
    token = await accessToken();
  } catch (e) {
    if (required) fail(e.message);
    console.log(`스토어: 미확인 — ${e.message}`);
    return null;
  }
  if (!token) {
    if (required) fail(KEY_HINT);
    console.log('스토어: 미확인 — CWS_SERVICE_ACCOUNT_KEY 없음');
    return null;
  }
  return createClient({ token, publisherId: process.env.CWS_PUBLISHER_ID || undefined });
}

function printStatus(summary) {
  const rev = (r) => (r ? `${r.versions.join(', ') || '버전 없음'} (${r.state})` : '없음');
  console.log(`스토어 게시: ${rev(summary.published)}\n심사 중: ${rev(summary.submitted)}\n마지막 업로드: ${summary.lastUpload ?? '24시간 안에 없음'}`);
  if (summary.takenDown) console.log('⚠️ 정책 위반으로 내려감(takenDown)');
  if (summary.warned) console.log('⚠️ 정책 경고(warned) — 해결하지 않으면 내려간다');
}

/** 기록 한 줄 — 제출을 물을 때 사람에게 보여 줄 커밋·SHA·단계 */
function describeRecord(r) {
  const steps = [r.upload && '업로드', r.submit && '제출', r.finish && '태그·릴리스'].filter(Boolean).join('·') || '점검만';
  return `기록 ${r.version}: 커밋 ${r.commit.slice(0, 7)} · zip SHA-256 ${r.sha256} · e2e ${r.e2e ? '통과' : '건너뜀'} · ${steps} (${paths(r.version).dir})`;
}

/** 지난 기록은 지우지 않고 이름을 바꿔 둔다 */
function archive(path, stamp) {
  if (existsSync(path)) renameSync(path, path.replace(/(\.\w+)$/, `.${stamp}$1`));
}

async function check({ e2e, redo }) {
  git('fetch', 'origin', '--tags', '--quiet');
  const head = git('rev-parse', 'HEAD');
  const tree = treeProblems({ head, originMain: git('rev-parse', 'origin/main'), porcelain: git('status', '--porcelain') });
  if (tree.length) fail(tree.join('\n'));
  const version = currentVersion();
  const existing = readRecord(version);
  const again = checkGate(existing, { redo });
  if (again) fail(again);
  const latestTag = latestVersionTag(tags());
  const cws = await store({ required: false });
  let published = null;
  if (cws) {
    const summary = summarizeStatus(await cws.fetchStatus());
    printStatus(summary);
    published = publishedVersion(summary);
  }
  const problems = versionProblems({ manifest: version, pkg: readJson('package.json').version, latestTag, published });
  if (problems.length) fail(problems.join('\n'));
  run('pnpm', 'test');
  run('pnpm', 'typecheck');
  if (e2e) run('pnpm', 'e2e');
  else console.log('e2e 건너뜀(--no-e2e) — 기록에 남긴다');
  run('pnpm', 'package');
  // 테스트가 도는 몇 분 사이에 바뀐 파일이 패키지에 들어가지 않았는지
  if (git('rev-parse', 'HEAD') !== head || git('status', '--porcelain') !== '') fail('점검하는 동안 커밋이나 파일이 바뀌었다 — check를 다시');
  let listingChanged = true;
  if (latestTag) {
    const { changed, imagesChanged } = compareListing(latestTag, textsFrom((p) => readFileSync(p, 'utf8')));
    listingChanged = changed.size > 0 || imagesChanged;
  }
  const p = paths(version);
  if (existing) {
    const stamp = existing.checkedAt.replace(/[^0-9]/g, '');
    for (const f of [p.record, p.zip, p.notes]) archive(f, stamp);
  }
  mkdirSync(p.dir, { recursive: true });
  copyFileSync(`release/${zipName(version)}`, p.zip);
  const record = { version, commit: head, zip: p.zip, sha256: sha256(p.zip), e2e, listingChanged, checkedAt: new Date().toISOString() };
  writeRecord(record);
  console.log(`
점검 통과 — ${describeRecord(record)}
등록정보: ${listingChanged ? `바뀜(${latestTag ?? '태그 없음'}와 다름) — pnpm store:upload 도우미로 대시보드 초안에 먼저 넣는다` : '그대로'}
다음: pnpm release upload`);
}

async function upload() {
  const version = currentVersion();
  const record = readRecord(version);
  const gate = uploadGate(record, { zipSha: zipSha(version) });
  if (gate) fail(gate);
  const cws = await store({ required: true });
  const done = await waitForUpload(cws, await cws.upload(readFileSync(paths(version).zip)));
  // 비동기로 끝난 업로드는 응답에 버전이 없다 — 그때는 올린 zip(기록의 SHA)으로만 확인된다
  if (done.crxVersion && done.crxVersion !== version) fail(`스토어가 받은 버전 ${done.crxVersion} ≠ ${version}`);
  record.upload = { version, sha256: record.sha256, state: done.uploadState, at: new Date().toISOString() };
  writeRecord(record);
  console.log(`초안 업로드 (${done.uploadState}) — 아직 공개되지 않는다
${describeRecord(record)}
다음: pnpm release submit --confirm ${version}${record.listingChanged ? ' --listing-done (대시보드 초안에 글·그림을 넣은 뒤)' : ''}`);
}

async function submit({ confirm, listingDone }) {
  const version = currentVersion();
  const record = readRecord(version);
  const gate = submitGate(record, { confirm, listingDone, zipSha: zipSha(version) });
  if (gate) fail(gate);
  const cws = await store({ required: true });
  const res = await cws.publish();
  record.submit = { state: res.state ?? null, at: new Date().toISOString() };
  writeRecord(record);
  for (const w of res.warningInfo?.warnings ?? []) console.log(`⚠️ ${w.reason}: ${w.description}`);
  console.log(`심사 제출 — 상태 ${res.state ?? '미확인'}. 승인되면 자동 게시된다
${describeRecord(record)}
다음: store/README 제출 기록에 행 추가(main에 병합) · 게시 확인 pnpm release status · 게시 뒤 pnpm release notes → finish --confirm ${version}`);
}

async function status() {
  const record = readRecord(currentVersion());
  if (record) console.log(describeRecord(record));
  const cws = await store({ required: false });
  if (cws) printStatus(summarizeStatus(await cws.fetchStatus()));
}

/** 릴리스 노트 초안 — origin/main의 store/README 제출 기록 행에서. 이미 있으면 덮지 않는다 */
async function notes() {
  const version = currentVersion();
  const record = readRecord(version);
  if (!record?.submit) fail(`${version} 제출 기록이 없다 — 노트는 제출한 뒤에`);
  const file = paths(version).notes;
  if (existsSync(file)) {
    console.log(`릴리스 노트가 이미 있다: ${file}`);
    return;
  }
  git('fetch', 'origin', '--quiet');
  const what = submissionWhat(git('show', 'origin/main:store/README.md'), version);
  if (!what) fail(`origin/main의 store/README 제출 기록에 ${version} 행이 없다 — 행 PR을 먼저 병합한다`);
  writeFileSync(file, notesDraft({ version, what, sha256: record.sha256 }));
  console.log(`릴리스 노트 초안: ${file}\n고쳐 쓰고(v1.0.0 노트처럼 영어 + 한국어) 첫 줄 표시를 지운 뒤 finish --confirm ${version}`);
}

async function finish({ confirm }) {
  const version = currentVersion();
  const record = readRecord(version);
  const cws = await store({ required: true });
  git('fetch', 'origin', '--tags', '--quiet');
  const gate = finishGate(record, { confirm, published: publishedVersion(summarizeStatus(await cws.fetchStatus())), zipSha: zipSha(version) });
  if (gate) fail(gate);
  const p = paths(version);
  // finish는 초안을 만들지 않는다 — 노트가 없으면 notes 단계부터
  if (!existsSync(p.notes)) fail(`릴리스 노트가 없다 — pnpm release notes로 초안을 만들고 고쳐 쓴 뒤`);
  const problem = notesProblem(readFileSync(p.notes, 'utf8'), record.sha256);
  if (problem) fail(problem);
  const tag = `v${version}`;
  const plan = tagPlan({ existingTagCommit: tags().includes(tag) ? git('rev-list', '-n', '1', tag) : null, recordCommit: record.commit });
  if (plan.problem) fail(plan.problem);
  let releaseExists = true;
  try {
    execFileSync('gh', ['release', 'view', tag], { stdio: 'ignore', env: childEnv });
  } catch {
    releaseExists = false;
  }
  if (releaseExists) fail(`GitHub Release ${tag}가 이미 있다 — 건드리지 않고 멈춘다`);
  if (plan.action === 'create') run('git', 'tag', '-a', tag, record.commit, '-m', `Markdown Diff Cat for GitHub ${version}`);
  else console.log(`태그 ${tag}가 이미 같은 커밋에 있다 — 이어서 진행`);
  run('git', 'push', 'origin', tag);
  run('gh', 'release', 'create', tag, p.zip, '--title', version, '--notes-file', p.notes);
  record.finish = { at: new Date().toISOString() };
  writeRecord(record);
  console.log(`${tag} 태그·GitHub Release 완료 — store/README 제출 기록 상태를 갱신한다`);
}

const opts = parseArgs(process.argv.slice(2));
const steps = { check, upload, submit, status, notes, finish };
const step = steps[opts.step];
if (!step) fail('단계: check [--no-e2e] [--redo] | upload | submit --confirm X.Y.Z [--listing-done] | status | notes | finish --confirm X.Y.Z');
try {
  await step(opts);
} catch (e) {
  if (e instanceof CwsError) fail(e.message);
  throw e;
}

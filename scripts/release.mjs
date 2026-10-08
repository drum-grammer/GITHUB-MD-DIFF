// 스토어 업데이트 하네스 — pnpm release <check|upload|submit|status|finish>
// check(점검·패키지·기록) → upload(초안, 비공개) → submit --confirm X.Y.Z(심사 제출, 승인되면 자동 게시) → status → finish --confirm X.Y.Z(태그·GitHub Release)
// 키: CWS_SERVICE_ACCOUNT_KEY(서비스 계정 JSON 키 전체). 없으면 check·status는 스토어 부분을 미확인으로 두고, upload·submit·finish는 멈춘다
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CwsError, accessToken, createClient, publishedVersion, summarizeStatus, waitForUpload } from './cws.mjs';
import {
  finishGate,
  latestVersionTag,
  notesDraft,
  notesPath,
  notesProblem,
  parseArgs,
  recordPath,
  submissionWhat,
  submitGate,
  treeProblems,
  uploadGate,
  versionProblems,
  zipName,
} from './release-lib.mjs';
import { compareListing, textsFrom } from './store-texts.mjs';

const KEY_HINT = '서비스 계정 키가 필요하다 — 환경변수 CWS_SERVICE_ACCOUNT_KEY(JSON 키 전체). 설정: store/README.md "Releasing an update"';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const currentVersion = () => readJson('static/manifest.json').version;
const readRecord = (v) => (existsSync(recordPath(v)) ? readJson(recordPath(v)) : null);
const writeRecord = (r) => writeFileSync(recordPath(r.version), `${JSON.stringify(r, null, 2)}\n`);
const tags = () => git('tag', '--list', 'v*').split('\n').filter(Boolean);

function fail(message) {
  console.error(`멈춤: ${message}`);
  process.exit(1);
}

function run(cmd, ...a) {
  try {
    execFileSync(cmd, a, { stdio: 'inherit' });
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

async function check({ e2e }) {
  git('fetch', 'origin', '--tags', '--quiet');
  const head = git('rev-parse', 'HEAD');
  const tree = treeProblems({ head, originMain: git('rev-parse', 'origin/main'), porcelain: git('status', '--porcelain') });
  if (tree.length) fail(tree.join('\n'));
  const version = currentVersion();
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
  const zip = `release/${zipName(version)}`;
  let listingChanged = true;
  if (latestTag) {
    const { changed, imagesChanged } = compareListing(latestTag, textsFrom((p) => readFileSync(p, 'utf8')));
    listingChanged = changed.size > 0 || imagesChanged;
  }
  const record = { version, commit: head, zip, sha256: sha256(zip), e2e, listingChanged, checkedAt: new Date().toISOString() };
  writeRecord(record);
  console.log(`
점검 통과 ${version} — ${zip}
SHA-256 ${record.sha256} · 커밋 ${head.slice(0, 7)} · e2e ${e2e ? '통과' : '건너뜀'}
등록정보: ${listingChanged ? `바뀜(${latestTag ?? '태그 없음'}와 다름) — pnpm store:upload 도우미로 대시보드 초안에 먼저 넣는다` : '그대로'}
다음: pnpm release upload`);
}

async function upload() {
  const version = currentVersion();
  const record = readRecord(version);
  const gate = uploadGate(record, { head: git('rev-parse', 'HEAD'), sha256: record && existsSync(record.zip) ? sha256(record.zip) : '' });
  if (gate) fail(gate);
  const cws = await store({ required: true });
  const done = await waitForUpload(cws, await cws.upload(readFileSync(record.zip)));
  if (done.crxVersion && done.crxVersion !== version) fail(`스토어가 받은 버전 ${done.crxVersion} ≠ ${version}`);
  record.upload = { version, state: done.uploadState, at: new Date().toISOString() };
  writeRecord(record);
  console.log(`초안 업로드 ${version} (${done.uploadState}) — 아직 공개되지 않는다
다음: pnpm release submit --confirm ${version}${record.listingChanged ? ' --listing-done (대시보드 초안에 글·그림을 넣은 뒤)' : ''}`);
}

async function submit({ confirm, listingDone }) {
  const record = readRecord(currentVersion());
  const gate = submitGate(record, { confirm, listingDone });
  if (gate) fail(gate);
  const cws = await store({ required: true });
  const res = await cws.publish();
  record.submit = { state: res.state ?? null, at: new Date().toISOString() };
  writeRecord(record);
  for (const w of res.warningInfo?.warnings ?? []) console.log(`⚠️ ${w.reason}: ${w.description}`);
  console.log(`심사 제출 ${record.version} — 상태 ${res.state ?? '미확인'}. 승인되면 자동 게시된다
다음: store/README 제출 기록에 행 추가 · 게시 확인 pnpm release status · 게시 뒤 pnpm release finish --confirm ${record.version}`);
}

async function status() {
  const cws = await store({ required: false });
  if (cws) printStatus(summarizeStatus(await cws.fetchStatus()));
}

async function finish({ confirm }) {
  const version = currentVersion();
  const record = readRecord(version);
  const cws = await store({ required: true });
  git('fetch', 'origin', '--tags', '--quiet');
  const gate = finishGate(record, { confirm, published: publishedVersion(summarizeStatus(await cws.fetchStatus())), tags: tags() });
  if (gate) fail(gate);
  if (sha256(record.zip) !== record.sha256) fail('zip이 기록과 다르다 — 스토어에 올린 그 zip이어야 한다');
  const notes = notesPath(version);
  if (!existsSync(notes)) {
    const what = submissionWhat(readFileSync('store/README.md', 'utf8'), version);
    if (!what) fail(`store/README 제출 기록에 ${version} 행이 없다 — 먼저 넣는다`);
    writeFileSync(notes, notesDraft({ version, what, sha256: record.sha256 }));
    console.log(`릴리스 노트 초안 ${notes} — 고쳐 쓰고 첫 줄 표시를 지운 뒤 finish를 다시`);
    return;
  }
  const problem = notesProblem(readFileSync(notes, 'utf8'), record.sha256);
  if (problem) fail(problem);
  run('git', 'tag', '-a', `v${version}`, record.commit, '-m', `Markdown Diff Cat for GitHub ${version}`);
  run('git', 'push', 'origin', `v${version}`);
  run('gh', 'release', 'create', `v${version}`, record.zip, '--title', version, '--notes-file', notes);
  console.log(`v${version} 태그·GitHub Release 완료 — store/README 제출 기록 상태를 갱신한다`);
}

const opts = parseArgs(process.argv.slice(2));
const steps = { check, upload, submit, status, finish };
const step = steps[opts.step];
if (!step) fail('단계: check [--no-e2e] | upload | submit --confirm X.Y.Z [--listing-done] | status | finish --confirm X.Y.Z');
try {
  await step(opts);
} catch (e) {
  if (e instanceof CwsError) fail(e.message);
  throw e;
}

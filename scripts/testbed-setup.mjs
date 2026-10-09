// pnpm testbed:setup [--rebuild] — 공개 테스트 저장소(testbed)를 만들고 시나리오 PR·리뷰 스레드를 맞춘다. 여러 번 돌려도 결과가 같다.
// 1) 저장소가 없으면 만든다(공개) 2) TESTBED_VERSION이 testbed/scenarios.ts의 FIXTURE_VERSION과 다르면(또는 --rebuild) 열린 PR을 닫고
// 브랜치를 다시 밀고 PR을 새로 연다 3) 미리 심을 스레드(SEEDS)가 없으면 달고 해결 상태를 맞춘다 4) 지난 실행이 남긴 코멘트·보류 중인 리뷰를 걷는다
// 결과(PR 번호·스레드 ID)는 .scratch/testbed/state.json — pnpm testbed가 읽는다. Node 22.18+(.ts를 바로 읽는다)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FIXTURE_VERSION, REPO, RUN_MARKER, SCENARIOS, SEEDS, SEED_TAG, baseFiles, seedLines } from '../testbed/scenarios.ts';
import { api, cleanRuns, comments, gh, me, setResolved, threads } from '../testbed/github.ts';

const OUT = resolve('.scratch/testbed');
const STATE = join(OUT, 'state.json');
const REBUILD = process.argv.includes('--rebuild');
const REMOTE = process.env.TESTBED_REMOTE ?? `git@github.com:${REPO}.git`;
const DATE = '2026-10-08T00:00:00Z'; // 커밋 시각을 고정해 같은 내용이면 같은 커밋이 되게 한다

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const log = (...a) => console.log('[testbed]', ...a);

/** GitHub가 막 만든 PR의 diff를 아직 계산하지 않았으면 422가 난다 — 잠깐 기다렸다 다시 */
function retry(fn, what) {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (i >= 5) throw e;
      log(`${what} 재시도 ${i + 1}: ${String(e.stderr ?? e.message).split('\n')[0]}`);
      sleep(3000 * (i + 1));
    }
  }
}

function git(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
}

function repoExists() {
  try {
    gh(['repo', 'view', REPO, '--json', 'name']);
    return true;
  } catch {
    return false;
  }
}

function remoteVersion() {
  try {
    const f = api(`repos/${REPO}/contents/TESTBED_VERSION`);
    return Buffer.from(f.content, 'base64').toString('utf8').trim();
  } catch {
    return null;
  }
}

function writeTree(dir, files) {
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
}

function applyOps(dir, ops) {
  for (const op of ops) {
    if ('write' in op) writeTree(dir, { [op.write]: op.content });
    else if ('remove' in op) git(dir, ['rm', '-q', op.remove]);
    else {
      mkdirSync(dirname(join(dir, op.to)), { recursive: true });
      git(dir, ['mv', op.move, op.to]);
      if (op.content !== undefined) writeFileSync(join(dir, op.to), op.content);
    }
  }
}

/** 기준 커밋(main)과 시나리오마다 브랜치 하나를 만든다(따라온 커밋이 있으면 그 위에 하나 더) */
function buildLocal() {
  const dir = join(OUT, 'repo');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const name = git(process.cwd(), ['config', 'user.name']).trim();
  const email = git(process.cwd(), ['config', 'user.email']).trim();
  const env = {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_AUTHOR_DATE: DATE,
    GIT_COMMITTER_DATE: DATE,
  };
  git(dir, ['init', '-q', '-b', 'main']);
  writeTree(dir, baseFiles());
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', `Testbed fixtures v${FIXTURE_VERSION}`], env);
  for (const s of SCENARIOS) {
    git(dir, ['checkout', '-q', '-B', s.branch, 'main']);
    applyOps(dir, s.ops);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', s.title], env);
    if (s.followup) {
      // 리뷰 뒤 작성자가 올린 커밋 — 첫 커밋에 단 스레드가 낡는다. 시각을 1분 늦춰 순서를 고정한다
      applyOps(dir, s.followup);
      git(dir, ['add', '-A']);
      const later = { ...env, GIT_AUTHOR_DATE: '2026-10-08T00:01:00Z', GIT_COMMITTER_DATE: '2026-10-08T00:01:00Z' };
      git(dir, ['commit', '-q', '-m', `${s.title} — follow-up after review`], later);
    }
  }
  return dir;
}

function openPulls() {
  return api(`repos/${REPO}/pulls?state=open&per_page=100`);
}

function ensurePull(s) {
  const [owner] = REPO.split('/');
  const found = api(`repos/${REPO}/pulls?state=open&head=${owner}:${encodeURIComponent(s.branch)}`);
  if (found.length) return found[0];
  log(`PR 열기: ${s.branch}`);
  return retry(() => api(`repos/${REPO}/pulls`, 'POST', { title: s.title, head: s.branch, base: 'main', body: s.body }), 'PR 열기');
}

/** 미리 심을 스레드를 달고(없을 때만) 해결 상태를 맞춘다 */
function seed(pr, sha, key) {
  const list = SEEDS.filter((s) => s.scenario === key);
  if (!list.length) return {};
  const existing = comments(REPO, pr);
  const firstSha = list.some((s) => s.commit === 'first') ? api(`repos/${REPO}/pulls/${pr}/commits`)[0].sha : null;
  const out = {};
  for (const s of list) {
    const { line, startLine } = seedLines(s);
    let c = existing.find((x) => x.body.includes(SEED_TAG(s.key)));
    if (!c) {
      const commit = s.commit === 'first' ? firstSha : sha;
      log(`스레드 심기: ${s.key} (${s.path} ${s.subject === 'file' ? '파일 전체' : `${s.side} ${startLine ? `${startLine}–` : ''}${line}`}${s.commit === 'first' ? ' · 첫 커밋' : ''})`);
      const body = s.subject === 'file'
        ? { body: `${s.body}\n\n${SEED_TAG(s.key)}`, commit_id: commit, path: s.path, subject_type: 'file' }
        : { body: `${s.body}\n\n${SEED_TAG(s.key)}`, commit_id: commit, path: s.path, side: s.side, line };
      if (startLine && startLine !== line) Object.assign(body, { start_line: startLine, start_side: s.side });
      c = retry(() => api(`repos/${REPO}/pulls/${pr}/comments`, 'POST', body), `스레드 ${s.key}`);
    }
    if (s.reply && !existing.some((x) => x.in_reply_to_id === c.id && x.body.includes(SEED_TAG(`${s.key}-reply`)))) {
      log(`답글 심기: ${s.key}`);
      api(`repos/${REPO}/pulls/${pr}/comments/${c.id}/replies`, 'POST', { body: `${s.reply}\n\n${SEED_TAG(`${s.key}-reply`)}` });
    }
    out[s.key] = { id: c.id, path: s.path, side: s.side, line, startLine: startLine ?? null, body: s.body, reply: s.reply ?? null, resolved: Boolean(s.resolved) };
  }
  for (const t of threads(REPO, pr)) {
    const s = list.find((x) => out[x.key].id === t.firstCommentId);
    if (!s) continue;
    out[s.key].thread = t.id;
    if (t.isResolved !== Boolean(s.resolved)) {
      log(`해결 상태 맞추기: ${s.key} → ${s.resolved ? '해결' : '해결 안 됨'}`);
      setResolved(t.id, Boolean(s.resolved));
    }
  }
  return out;
}

const login = me();
mkdirSync(OUT, { recursive: true });

if (!repoExists()) {
  log(`저장소 만들기: ${REPO} (공개)`);
  gh([
    'repo', 'create', REPO, '--public', '--disable-issues', '--disable-wiki',
    '--description', 'Release test pull requests for Markdown Diff Cat for GitHub (generated, do not edit)',
    '--homepage', 'https://github.com/drum-grammer/GITHUB-MD-DIFF',
  ]);
}

const version = remoteVersion();
if (REBUILD || version !== FIXTURE_VERSION) {
  log(`내용 다시 만들기: 원격 ${version ?? '없음'} → ${FIXTURE_VERSION}`);
  for (const p of openPulls()) {
    log(`옛 PR 닫기: #${p.number}`);
    api(`repos/${REPO}/issues/${p.number}/comments`, 'POST', { body: `Superseded by testbed fixtures v${FIXTURE_VERSION}.` });
    api(`repos/${REPO}/pulls/${p.number}`, 'PATCH', { state: 'closed' });
  }
  const dir = buildLocal();
  git(dir, ['push', '--force', '--quiet', REMOTE, 'main']);
  git(dir, ['push', '--force', '--quiet', REMOTE, ...SCENARIOS.map((s) => s.branch)]);
}

const state = { repo: REPO, version: FIXTURE_VERSION, login, at: new Date().toISOString(), prs: {}, seeds: {}, cleaned: 0 };
for (const s of SCENARIOS) {
  const pr = ensurePull(s);
  state.prs[s.key] = { number: pr.number, url: pr.html_url, head: pr.head.sha };
  state.cleaned += cleanRuns(REPO, pr.number, RUN_MARKER, login);
  Object.assign(state.seeds, seed(pr.number, pr.head.sha, s.key));
}
writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
for (const [k, p] of Object.entries(state.prs)) log(`${k}: ${p.url}/changes`);
log(`스레드 ${Object.keys(state.seeds).length}개 · 걷은 테스트 흔적 ${state.cleaned}개 → ${STATE}`);

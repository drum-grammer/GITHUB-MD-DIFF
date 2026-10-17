// pnpm parity:setup [--confirm] — 공개 testbed 저장소에 패리티 전용 브랜치 둘(parity/base·parity/head)과 초안 PR 하나를 맞춘다.
// 공개 저장소에 쓰는 일이라 --confirm 없이는 할 일만 보여 주고 끝난다(본인이 채팅에서 허락한 뒤에만 --confirm). 여러 번 돌려도 같다.
// main·testbed 시나리오 브랜치·FIXTURE_VERSION은 건드리지 않는다. 두 브랜치는 parity/ 파일만 담은 별도 역사다.
// 결과(PR 번호·주소)는 .scratch/parity/state.json. Node 22.18+(.ts를 바로 읽는다)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PARITY_BASE, PARITY_BODY, PARITY_CASES, PARITY_HEAD, PARITY_TITLE } from '../testbed/parity-scenarios.ts';
import { REPO } from '../testbed/scenarios.ts';
import { api } from '../testbed/github.ts';

const OUT = resolve('.scratch/parity');
const REMOTE = process.env.TESTBED_REMOTE ?? `git@github.com:${REPO}.git`;
const DATE = '2026-10-16T00:00:00Z'; // 같은 내용이면 같은 커밋이 되게
const log = (...a) => console.log('[parity-setup]', ...a);

log(`저장소 ${REPO} · 브랜치 ${PARITY_BASE}(옛) ← ${PARITY_HEAD}(새) · 파일 ${PARITY_CASES.length}개(parity/<이름>.md) · 초안 PR "${PARITY_TITLE}"`);
if (!process.argv.includes('--confirm')) {
  log('공개 저장소에 쓰는 일이다 — 본인이 채팅에서 허락한 뒤 --confirm을 붙여 다시 돌린다');
  process.exit(1);
}

function git(cwd, args) {
  const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim();
  const email = execFileSync('git', ['config', 'user.email'], { encoding: 'utf8' }).trim();
  const env = { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE };
  return execFileSync('git', args, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
}

const dir = join(OUT, 'repo');
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'parity'), { recursive: true });
git(dir, ['init', '-q', '-b', PARITY_BASE]);
for (const c of PARITY_CASES) writeFileSync(join(dir, 'parity', `${c.name}.md`), c.old);
git(dir, ['add', '-A']);
git(dir, ['commit', '-q', '-m', 'Parity fixtures: before']);
git(dir, ['checkout', '-q', '-b', PARITY_HEAD]);
for (const c of PARITY_CASES) writeFileSync(join(dir, 'parity', `${c.name}.md`), c.new);
git(dir, ['add', '-A']);
git(dir, ['commit', '-q', '-m', 'Parity fixtures: after']);
git(dir, ['push', '--force', '--quiet', REMOTE, PARITY_BASE, PARITY_HEAD]);
log('브랜치 밀기 끝');

const [owner] = REPO.split('/');
let pr = api(`repos/${REPO}/pulls?state=open&head=${owner}:${encodeURIComponent(PARITY_HEAD)}`)[0];
if (!pr) {
  log('초안 PR 열기');
  pr = api(`repos/${REPO}/pulls`, 'POST', { title: PARITY_TITLE, head: PARITY_HEAD, base: PARITY_BASE, body: PARITY_BODY, draft: true });
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'state.json'), JSON.stringify({ repo: REPO, number: pr.number, url: pr.html_url, at: new Date().toISOString() }, null, 2) + '\n');
log(`${pr.html_url}/changes`);

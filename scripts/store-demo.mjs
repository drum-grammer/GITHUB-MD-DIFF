// 스토어 스크린샷용 시연 PR 하네스 — 버전마다 store/demos/v<버전>/에 문서(전·후)와 demo.json을 두고, 필요할 때 시연 PR을 새로 만든다
// 사용:
//   pnpm store:demo list                 버전별 시연 PR과 상태
//   pnpm store:demo check [v1.5.0]       demo.json·문서 검사(캡처가 찾는 제목·문단이 head 문서에 있는지)
//   pnpm store:demo create v1.6.0 [--lang en,ko] [--dry-run]
//        origin/main에서 demo/v1.6.0/base(전 문서) → demo/v1.6.0/<lang>(후 문서) 브랜치를 만들어 푸시하고 초안 PR을 연 뒤 demo.json에 PR 번호를 적는다
// 시연 PR은 병합하지 않는다 — 캡처가 그 변경 화면을 찍는다. 예전 버전 브랜치·PR은 건드리지 않는다(기록)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DEMOS_DIR, LANGS, branchPlan, checkDemo, latestVersion, listDemos, loadDemo } from './store-demo-lib.mjs';

const REPO = 'drum-grammer/GITHUB-MD-DIFF';
const [cmd = 'list', ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const arg = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const positional = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--lang');
const run = (bin, args, opts = {}) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const fail = (msg) => {
  console.error(`멈춤: ${msg}`);
  process.exit(1);
};

if (cmd === 'list') {
  for (const dir of listDemos().sort()) {
    const d = loadDemo(dir);
    const prs = LANGS.map((l) => {
      const pr = d.langs?.[l]?.pr;
      if (!pr) return `${l} —`;
      let state = '';
      try {
        state = run('gh', ['pr', 'view', String(pr), '--repo', REPO, '--json', 'state', '--jq', '.state']);
      } catch {
        state = '확인 못 함';
      }
      return `${l} #${pr} (${state})`;
    });
    console.log(`${dir}  ${prs.join(' · ')}  — ${d.about}`);
  }
  console.log(`캡처 기본값: ${latestVersion(listDemos()) ?? '없음'}(DEMO_VERSION으로 바꾼다)`);
} else if (cmd === 'check') {
  const dirs = positional.length ? positional : listDemos();
  const problems = dirs.flatMap((d) => checkDemo(d));
  if (problems.length) fail(`\n${problems.join('\n')}`);
  console.log(`시연 기록 ${dirs.length}개 문제 없음: ${dirs.join(', ')}`);
} else if (cmd === 'create') {
  const dir = positional[0];
  if (!dir) fail('버전 폴더를 준다 — 예: pnpm store:demo create v1.6.0');
  const problems = checkDemo(dir);
  if (problems.length) fail(`먼저 ${DEMOS_DIR}/${dir}/를 고친다:\n${problems.join('\n')}`);
  const demo = loadDemo(dir);
  const langs = (arg('--lang') ?? LANGS.join(',')).split(',');
  const taken = langs.filter((l) => demo.langs[l].pr);
  if (taken.length) fail(`${taken.join(', ')}에는 이미 시연 PR이 있다(${taken.map((l) => `#${demo.langs[l].pr}`).join(', ')}). 새 시연은 새 버전 폴더로 만든다`);
  const plan = branchPlan(demo.version, langs);
  run('git', ['fetch', 'origin', 'main', '--quiet']);
  const existing = run('git', ['ls-remote', '--heads', 'origin', `demo/v${demo.version}/*`]);
  if (existing) fail(`원격에 이미 브랜치가 있다:\n${existing}`);
  console.log(`계획: origin/main → ${plan.base}(전 문서 ${langs.map((l) => demo.langs[l].base).join(', ')})`);
  for (const l of langs) console.log(`       ${plan.base} → ${plan.heads[l]}(후 문서 ${demo.langs[l].head}) → 초안 PR(base ${plan.base})`);
  if (flags.has('--dry-run')) process.exit(0);

  const src = resolve(DEMOS_DIR, dir);
  const wt = mkdtempSync(join(tmpdir(), 'gmd-demo-'));
  rmSync(wt, { recursive: true, force: true });
  run('git', ['worktree', 'add', '--detach', wt, 'origin/main']);
  const put = (lang, which) => {
    const target = join(wt, demo.langs[lang].path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(src, demo.langs[lang][which]), 'utf8'));
    run('git', ['-C', wt, 'add', demo.langs[lang].path]);
  };
  try {
    for (const l of langs) put(l, 'base');
    run('git', ['-C', wt, 'commit', '-q', '-m', `demo: ${demo.version} 시연 기준(변경 전) — ${DEMOS_DIR}/${dir}`]);
    const baseSha = run('git', ['-C', wt, 'rev-parse', 'HEAD']);
    run('git', ['-C', wt, 'push', '-q', 'origin', `HEAD:refs/heads/${plan.base}`]);
    for (const l of langs) {
      run('git', ['-C', wt, 'checkout', '-q', '--detach', baseSha]);
      put(l, 'head');
      run('git', ['-C', wt, 'commit', '-q', '-m', `demo: ${demo.version} 시연(${l}, 변경 후) — ${DEMOS_DIR}/${dir}`]);
      run('git', ['-C', wt, 'push', '-q', 'origin', `HEAD:refs/heads/${plan.heads[l]}`]);
      const url = run('gh', ['pr', 'create', '--repo', REPO, '--draft', '--base', plan.base, '--head', plan.heads[l],
        '--title', `Demo (${l}) ${demo.version}: ${demo.about.slice(0, 80)}`,
        '--body', `Store screenshot demo for ${demo.version} (${l}). **Never merge** — \`store/capture.mjs\` captures this diff. Made with \`pnpm store:demo create ${dir}\` from \`${DEMOS_DIR}/${dir}/\`.`]);
      demo.langs[l].pr = Number(url.match(/\/pull\/(\d+)/)[1]);
      demo.langs[l].branch = plan.heads[l];
      console.log(`${l}: ${url}`);
    }
    demo.baseBranch = plan.base;
    writeFileSync(join(src, 'demo.json'), `${JSON.stringify(demo, null, 2)}\n`);
    console.log(`${DEMOS_DIR}/${dir}/demo.json에 PR 번호를 적었다 — 커밋해서 PR로 올린다. 캡처: DEMO_VERSION=${dir} pnpm store:assets`);
  } finally {
    run('git', ['worktree', 'remove', '--force', wt]);
  }
} else {
  fail(`모르는 명령 ${cmd} — list · check · create`);
}

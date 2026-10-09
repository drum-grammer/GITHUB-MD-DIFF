// pnpm verify <quick|pr|release> [--bail] [--skip 단계,…] [--list] — 검증 등급 하나를 한 번에 돌리고 결과를 보고서로 남긴다.
//   quick   개발 중 수시로(약 1분): 타입·단위·빌드 + 테스트 저장소 @quick 시나리오(읽기만)
//   pr      PR 병합 전(약 8분): quick의 검사 + E2E(쓰기 포함)·카나리 + 테스트 저장소 Split 모든 시나리오
//   release 검수 요청 전 전체(약 30분): pr + 화면 모양 4가지 매트릭스 + 공개 PR 16개 재탐험 + 성능 + 패키지
// 단계가 실패해도 끝까지 돌고(--bail이면 멈춤) 결과를 .scratch/verify/<날짜-시각>-<등급>/report.md·report.json에 쓴다.
// 오래 걸리는 등급은 끊겨도 되게 가족 저장소의 longrun으로 돌린다(그 밖에서는 그냥 돌려도 된다). 끝 코드는 실패가 있으면 1
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PERF_PRS = ['https://github.com/reactjs/ko.react.dev/pull/1565/changes', 'https://github.com/microsoft/vscode-docs/pull/10431/changes'];

/** 단계 — cmd는 [명령, 인자], summary는 출력에서 한 줄 요약을 뽑는다 */
const STEPS = {
  typecheck: { name: '타입 검사', cmd: ['pnpm', ['-s', 'typecheck']] },
  unit: { name: '단위·DOM 테스트', cmd: ['pnpm', ['-s', 'test']], summary: vitest },
  build: { name: '빌드', cmd: ['node', ['build.mjs']] },
  'testbed-setup': { name: '테스트 저장소 맞추기', cmd: ['node', ['scripts/testbed-setup.mjs']], summary: (o) => last(o, /스레드 \d+개[^\n→]*/) },
  'testbed-quick': { name: '테스트 저장소 @quick', cmd: ['npx', ['playwright', 'test', '-c', 'testbed/playwright.config.ts', '--project', 'split', '--grep', '@quick']], summary: playwright, testbed: true },
  e2e: { name: 'E2E(쓰기 포함)', cmd: ['npx', ['playwright', 'test']], env: { GMD_E2E_WRITE: '1' }, summary: playwright },
  canary: { name: '카나리(실제 GitHub, 읽기만)', cmd: ['node', ['scripts/canary.mjs']], summary: (o) => last(o, /모두 정상[^\n—]*|문제 \d+[^\n]*/) },
  'testbed-split': { name: '테스트 저장소 Split 전체', cmd: ['npx', ['playwright', 'test', '-c', 'testbed/playwright.config.ts', '--project', 'split']], summary: playwright, testbed: true },
  'testbed-all': { name: '테스트 저장소 화면 모양 5가지', cmd: ['npx', ['playwright', 'test', '-c', 'testbed/playwright.config.ts']], summary: playwright, testbed: true },
  explore: { name: '공개 PR 16개 재탐험(읽기만)', cmd: null, summary: explore },
  perf: { name: '성능(확장 끔·켬, 2회)', cmd: ['node', ['scripts/perf.mjs', '--reps', '2', ...PERF_PRS]], summary: perf },
  package: { name: '스토어 패키지', cmd: ['node', ['scripts/package.mjs']], summary: pkgSummary },
};

export const TIERS = {
  quick: { name: '최소(개발 중)', steps: ['typecheck', 'unit', 'build', 'testbed-setup', 'testbed-quick'] },
  pr: { name: '중간(PR 병합 전)', steps: ['typecheck', 'unit', 'build', 'e2e', 'canary', 'testbed-setup', 'testbed-split'] },
  release: { name: '전체(검수 요청 전)', steps: ['typecheck', 'unit', 'build', 'e2e', 'canary', 'testbed-setup', 'testbed-all', 'explore', 'perf', 'package'] },
};

function last(out, re) {
  const all = out.match(new RegExp(re.source, 'g'));
  return all ? all[all.length - 1].trim() : '';
}
function vitest(out) {
  const t = last(out, /Tests\s+[^\n]+/);
  return t.replace(/\s+/g, ' ');
}
function playwright(out) {
  const parts = ['passed', 'failed', 'flaky', 'skipped'].map((k) => last(out, new RegExp(`\\d+ ${k}`))).filter(Boolean);
  return parts.join(' · ');
}
function explore(out) {
  const pick = (re) => last(out, re);
  return [pick(/안내\(토스트\) \d+/), pick(/확장 예외 \d+/), pick(/확장 경고 \d+/), pick(/원문 줄 연결 [^\n]+/), pick(/"\+" 확인 [^\n]+/)].filter(Boolean).join(' · ');
}
function perf(out) {
  return out
    .split('\n')
    .filter((l) => /^\S+#\d+ \| /.test(l))
    .map((l) => {
      const c = l.split(' | ');
      return `${c[0].split('/').pop()} 확장 CPU ${c[1]}ms · 렌더링→접기 ${c[7]}ms`;
    })
    .join('; ');
}
function pkgSummary(out) {
  const zip = last(out, /release\/[^\s]+\.zip/);
  if (!zip || !existsSync(zip)) return zip;
  return `${zip} · SHA-256 ${createHash('sha256').update(readFileSync(zip)).digest('hex').slice(0, 16)}…`;
}

const fmt = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`;
};

function run(cmd, args, env, log) {
  return new Promise((done) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (d) => {
      out += d;
      log.write(d);
    };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('close', (code) => done({ code: code ?? 1, out }));
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const [key, tier] of Object.entries(TIERS)) console.log(`${key} — ${tier.name}: ${tier.steps.map((s) => STEPS[s].name).join(' → ')}`);
    return 0;
  }
  const tierKey = args.find((a) => TIERS[a]);
  if (!tierKey) {
    console.error('쓰기: pnpm verify <quick|pr|release> [--bail] [--skip 단계,…] [--list]');
    return 2;
  }
  const bail = args.includes('--bail');
  const skip = new Set((args[args.indexOf('--skip') + 1] ?? '').split(',').filter((x) => args.includes('--skip') && x));
  const tier = TIERS[tierKey];
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const dir = resolve('.scratch/verify', `${stamp}-${tierKey}`);
  mkdirSync(dir, { recursive: true });
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '';
  console.log(`[verify] ${tierKey} — ${tier.name} · ${version} · ${commit}${dirty ? ' (커밋 안 된 변경 있음)' : ''} → ${dir}`);

  const results = [];
  const t0 = Date.now();
  let stopped = false;
  for (const key of tier.steps) {
    const step = STEPS[key];
    if (stopped || skip.has(key)) {
      results.push({ key, name: step.name, status: 'skipped', ms: 0, summary: stopped ? '앞 단계 실패로 멈춤' : '--skip' });
      continue;
    }
    const log = createWriteStream(join(dir, `${key}.log`));
    const s0 = Date.now();
    process.stdout.write(`[verify] ${step.name} … `);
    let code;
    let out;
    if (key === 'explore') {
      const outDir = join(dir, 'explore');
      ({ code, out } = await run('node', ['scripts/explore.mjs', outDir, 'scripts/explore-regress.jsonl'], {}, log));
      if (code === 0) {
        const r = await run('node', ['scripts/explore-report.mjs', outDir], {}, log);
        out += r.out;
        // 오탐 안내·확장 예외가 하나라도 있으면 실패로 본다
        if (/안내\(토스트\) [1-9]|확장 예외 [1-9]/.test(r.out)) code = 1;
      }
    } else {
      ({ code, out } = await run(step.cmd[0], step.cmd[1], step.env ?? {}, log));
    }
    log.end();
    const ms = Date.now() - s0;
    const summary = step.summary ? step.summary(out) : '';
    const status = code === 0 ? 'passed' : 'failed';
    results.push({ key, name: step.name, status, ms, summary, log: `${key}.log` });
    console.log(`${status === 'passed' ? '✅' : '❌'} ${fmt(ms)}${summary ? ` — ${summary}` : ''}`);
    if (step.testbed && existsSync('.scratch/testbed/results.json')) {
      const r = await run('node', ['scripts/testbed-report.mjs', '--out', join(dir, `${key}-testbed.md`)], {}, createWriteStream(join(dir, `${key}-report.log`)));
      if (r.code !== 0) console.log(`[verify] 테스트 저장소 보고서를 만들지 못했어요(${key}-report.log)`);
    }
    if (status === 'failed' && bail) stopped = true;
  }
  const total = Date.now() - t0;
  const failed = results.filter((r) => r.status === 'failed').length;
  const ran = results.filter((r) => r.status !== 'skipped').length;
  const mark = { passed: '✅', failed: '❌', skipped: '⏭️' };
  const md = [
    `# Markdown Diff Cat 검증 — ${tierKey} · ${tier.name}`,
    '',
    `${version} · \`${commit}\`${dirty ? '(커밋 안 된 변경 있음)' : ''} · ${new Date(t0).toISOString().slice(0, 16).replace('T', ' ')} UTC · 총 ${fmt(total)} · ${failed ? `❌ 실패 ${failed}` : '✅ 모두 통과'} (${ran - failed}/${ran})`,
    '',
    '| 단계 | 결과 | 시간 | 요약 |',
    '|---|---|---|---|',
    ...results.map((r) => `| ${r.name} | ${mark[r.status]} | ${r.ms ? fmt(r.ms) : '—'} | ${(r.summary || '').replace(/\|/g, '\\|')} |`),
    '',
    ...results.filter((r) => existsSync(join(dir, `${r.key}-testbed.md`))).flatMap((r) => [`## ${r.name}`, '', readFileSync(join(dir, `${r.key}-testbed.md`), 'utf8').replace(/^### /gm, '#### '), '']),
    `단계별 기록: \`${dir}\``,
    '',
  ].join('\n');
  writeFileSync(join(dir, 'report.md'), md);
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ tier: tierKey, version, commit, dirty, startedAt: new Date(t0).toISOString(), totalMs: total, results }, null, 2) + '\n');
  console.log(`\n${md}`);
  return failed ? 1 : 0;
}

process.exitCode = await main();

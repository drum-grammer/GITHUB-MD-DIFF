// pnpm testbed:report [--out <파일>] — pnpm testbed 결과(.scratch/testbed/results.json)를 마크다운 표로 만든다.
// 보고서(docs/reports/)에 붙일 결과 절과 릴리스 노트에 넣을 한 줄(영어·한국어)을 같이 낸다. --out이 없으면 화면에만
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve('.scratch/testbed');
const results = JSON.parse(readFileSync(`${DIR}/results.json`, 'utf8'));
const state = JSON.parse(readFileSync(`${DIR}/state.json`, 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const plain = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '');
const cell = (s) => plain(s).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();

const rows = [];
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const r = t.results?.[t.results.length - 1] ?? {};
      const notes = [...(t.annotations ?? []), ...(r.annotations ?? [])].filter((a) => a.type === 'metric').map((a) => a.description);
      const [id, ...rest] = spec.title.split(' ');
      rows.push({
        id,
        project: t.projectName ?? 'split',
        title: rest.join(' ').replace(/\s*@(layout|quick)\b/g, ''),
        layout: /@layout\b/.test(spec.title),
        status: r.status ?? t.status,
        ms: r.duration ?? 0,
        notes: [...new Set(notes)],
        error: plain(r.error?.message ?? r.errors?.[0]?.message ?? '').split('\n').filter(Boolean).slice(0, 3).join(' / '),
      });
    }
  }
  for (const s of suite.suites ?? []) walk(s);
};
for (const s of results.suites ?? []) walk(s);
rows.sort((a, b) => a.id.localeCompare(b.id));

// 화면 모양(GitHub 톱니바퀴 메뉴)별 프로젝트 — split은 모든 시나리오, 나머지는 @layout 시나리오만
const LAYOUT_NAME = { split: 'Split', unified: 'Unified', whitespace: '공백 숨김', minimized: '코멘트 접기', compact: '좁은 줄 간격' };
const projects = [...new Set(rows.map((r) => r.project))].sort((a, b) => Object.keys(LAYOUT_NAME).indexOf(a) - Object.keys(LAYOUT_NAME).indexOf(b));
const main = rows.filter((r) => r.project === 'split');
const matrixIds = [...new Set(rows.filter((r) => r.layout).map((r) => r.id))];
const passed = rows.filter((r) => r.status === 'passed').length;
const failed = rows.filter((r) => r.status === 'failed' || r.status === 'timedOut').length;
const mark = { passed: '✅', failed: '❌', timedOut: '❌', skipped: '⏭️', interrupted: '⏸️' };
const when = results.stats?.startTime ? new Date(results.stats.startTime).toISOString().slice(0, 10) : '?';
const total = Math.round((results.stats?.duration ?? 0) / 1000);
const pr = (k) => `[#${state.prs[k].number}](${state.prs[k].url}/changes)`;

const lines = [
  `### 결과 — ${pkg.version} (\`${commit}\`), ${when}`,
  '',
  `[${state.repo}](https://github.com/${state.repo}) 내용 v${state.version} · 리뷰 시나리오 ${pr('review')} · 큰 diff ${pr('large')} · 파일 많은 PR ${pr('many')}${state.prs.followup ? ` · 리뷰 뒤 따라온 커밋 ${pr('followup')}` : ''}`,
  '',
  `**${passed}/${rows.length} 통과**${failed ? ` · 실패 ${failed}` : ''} · ${total}초 · 화면 모양 ${projects.map((p) => LAYOUT_NAME[p] ?? p).join('·')}`,
  '',
  '| | 시나리오(Split) | 결과 | 시간 | 기록 |',
  '|---|---|---|---|---|',
  ...main.map((r) => `| ${r.id} | ${cell(r.title)} | ${mark[r.status] ?? r.status} | ${(r.ms / 1000).toFixed(1)}초 | ${cell([...r.notes, r.error && `오류: ${r.error}`].filter(Boolean).join('<br>'))} |`),
  '',
  ...(projects.length > 1
    ? [
        '#### 화면 모양별',
        '',
        `| | ${projects.map((p) => LAYOUT_NAME[p] ?? p).join(' | ')} |`,
        `|---|${projects.map(() => '---').join('|')}|`,
        ...matrixIds.map((id) => `| ${id} | ${projects.map((p) => { const r = rows.find((x) => x.id === id && x.project === p); return r ? (mark[r.status] ?? r.status) : '—'; }).join(' | ')} |`),
        '',
        ...rows.filter((r) => r.project !== 'split' && r.error).map((r) => `- ${r.id} · ${LAYOUT_NAME[r.project] ?? r.project}: ${cell(r.error)}`),
        '',
      ]
    : []),
  '### 릴리스 노트에 넣을 줄',
  '',
  `- How it was tested: release scenarios on a public test repository ([${state.repo}](https://github.com/${state.repo}), \`pnpm testbed\`) in ${projects.length} GitHub diff layouts: ${passed}/${rows.length} passed — real comments (single, range, removed line, reply, renamed file), resolve and unresolve, seeded threads in place, a 2,400-line diff, and a 120-file pull request`,
  `- 검증: 공개 테스트 저장소 시나리오 ${passed}/${rows.length} 통과(\`pnpm testbed\`)`,
  '',
];
const md = lines.join('\n');
if (out) {
  writeFileSync(out, md);
  console.log(`→ ${out}`);
}
console.log(md);

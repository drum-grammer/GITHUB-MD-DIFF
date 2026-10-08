// pnpm explore의 결과를 요약한다: pnpm explore:report [결과 폴더 또는 results.jsonl] — 기본은 .scratch/explore/의 가장 최근 폴더
// 볼 것: 안내(토스트)·확장 예외·경고, 렌더링 안 된 파일, 원문으로 되돌린 파일, "+" 실패, 원문 줄 연결률, 접어서 숨긴 곳의 변경 표시
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function resultsFile(arg) {
  if (arg) return arg.endsWith('.jsonl') ? arg : join(arg, 'results.jsonl');
  const root = join('.scratch', 'explore');
  const dirs = readdirSync(root)
    .map((d) => join(root, d))
    .filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'results.jsonl')))
    .sort();
  if (dirs.length === 0) throw new Error(`${root}에 결과가 없다 — pnpm explore부터`);
  return join(dirs.at(-1), 'results.jsonl');
}

const file = resultsFile(process.argv[2]);
const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ok = rows.filter((r) => r.state);
const md = ok.flatMap((r) => r.state.md.map((f) => ({ ...f, key: r.key, fellBack: (r.fellBack ?? []).includes(f.path) })));
const pct = (a, b) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
const list = (title, items, show = (x) => x) => {
  console.log(`${title} ${items.length}`);
  for (const x of items.slice(0, 15)) console.log(`   ${show(x)}`);
  if (items.length > 15) console.log(`   … 외 ${items.length - 15}`);
};

console.log(`${file}\nPR ${rows.length}개 · 저장소 ${new Set(rows.map((r) => r.repo)).size}개 · 크롤러 실패 ${rows.length - ok.length}`);
const rendered = md.filter((f) => f.prose).length;
const noButton = md.filter((f) => !f.prose && f.rich === null).length;
const stuck = md.filter((f) => !f.prose && !f.collapsed && f.rich !== null && !f.fellBack);
console.log(`md 파일 ${md.length}: 렌더링 ${rendered} · 렌더링 버튼 없음(Load Diff·뼈대 등) ${noButton} · 원문으로 되돌림 ${md.filter((f) => f.fellBack).length} · 그 밖 ${stuck.length}`);
list('안내(토스트)', ok.filter((r) => r.state.toast), (r) => `${r.key} ${r.state.toast.text}`);
list('확장 예외', ok.flatMap((r) => (r.errors ?? []).map((e) => `${r.key} ${e.slice(0, 160)}`)));
list('확장 경고', ok.flatMap((r) => (r.warns ?? []).map((w) => `${r.key} ${w.split('\n')[0].slice(0, 160)}`)));
list('렌더링 안 됨(그 밖)', stuck, (f) => `${f.key} ${f.path.slice(-60)} rich=${f.rich} source=${f.source}`);
list('"바뀐 곳 안 보임" 안내', md.filter((f) => f.noChange), (f) => `${f.key} ${f.path.slice(-60)}`);
list('접어서 숨긴 곳의 변경 표시(있으면 안 됨)', md.filter((f) => f.hiddenChanges), (f) => `${f.key} ${f.path.slice(-60)} ${f.hiddenChanges}`);
const plus = ok.flatMap((r) => (r.plus ?? []).map((p) => ({ ...p, key: r.key })));
list(`"+" 확인 ${plus.length} · 실패`, plus.filter((p) => !p.ok), (p) => `${p.key} ${p.path.slice(-50)} ${p.error ?? ''}`);
const maps = ok.flatMap((r) => (r.mapping ?? []).map((m) => ({ ...m, key: r.key })));
const good = maps.filter((m) => !m.error && m.right);
const [a, b] = good.reduce(([x, y], m) => [x + m.right[0] + m.left[0], y + m.right[1] + m.left[1]], [0, 0]);
console.log(`원문 줄 연결 ${a}/${b} (${pct(a, b)}) · 오류 ${maps.length - good.length}`);
const low = good
  .map((m) => ({ ...m, r: (m.right[0] + m.left[0]) / Math.max(1, m.right[1] + m.left[1]) }))
  .filter((m) => m.r < 0.9)
  .sort((x, y) => x.r - y.r);
list('연결 90% 미만', low, (m) => `${(100 * m.r).toFixed(0)}% ${m.key} ${m.path.slice(-50)} ${m.miss.slice(0, 2).join(' | ').slice(0, 120)}`);
const slow = good.filter((m) => m.ms > 300).sort((x, y) => y.ms - x.ms);
list('연결 300ms 넘음', slow, (m) => `${m.ms}ms ${m.key} ${m.path.slice(-50)}`);

// 공개 저장소마다 최근 PR 중 마크다운 파일을 바꾼 PR을 고른다 — 읽기만 한다(gh api graphql).
// 쓰기: pnpm explore:pick [저장소 목록 파일] — 기본 scripts/explore-repos.txt, 결과는 .scratch/explore/targets.jsonl
// 저장소마다 최대 3개: 마크다운 파일이 가장 많은 PR, 마크다운 변경 줄이 가장 많은 PR, 가장 최근 PR. 비공개 저장소는 뺀다
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const LIST = process.argv[2] ?? 'scripts/explore-repos.txt';
const OUT = '.scratch/explore/targets.jsonl';
const MD = /\.(md|markdown|mdx)$/i;
const repos = readFileSync(LIST, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);

function query(batch) {
  const parts = batch.map((full, i) => {
    const [owner, name] = full.split('/');
    return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { nameWithOwner isPrivate pullRequests(last: 25) { nodes { number changedFiles files(first: 100) { nodes { path additions deletions } } } } }`;
  });
  try {
    const out = execFileSync('gh', ['api', 'graphql', '-f', `query={ ${parts.join(' ')} }`], { encoding: 'utf8', maxBuffer: 64 << 20 });
    return JSON.parse(out).data ?? {};
  } catch (e) {
    // 없는 저장소가 섞여도 나머지는 data에 온다
    try {
      return JSON.parse(e.stdout ?? '{}').data ?? {};
    } catch {
      return {};
    }
  }
}

const lines = [];
for (let k = 0; k < repos.length; k += 2) {
  for (const repo of Object.values(query(repos.slice(k, k + 2)))) {
    if (!repo || repo.isPrivate) continue;
    const prs = repo.pullRequests.nodes
      .map((pr) => {
        const md = (pr.files?.nodes ?? []).filter((f) => MD.test(f.path));
        return { n: pr.number, files: pr.changedFiles, md: md.length, mdLines: md.reduce((s, f) => s + f.additions + f.deletions, 0) };
      })
      .filter((pr) => pr.md > 0);
    if (prs.length === 0) continue;
    const pick = new Set([
      prs.reduce((a, b) => (b.md > a.md ? b : a)).n,
      prs.reduce((a, b) => (b.mdLines > a.mdLines ? b : a)).n,
      prs.at(-1).n,
    ]);
    lines.push(JSON.stringify({ repo: repo.nameWithOwner, private: false, prs: prs.filter((p) => pick.has(p.n)) }));
  }
  process.stderr.write(`\r${Math.min(k + 2, repos.length)}/${repos.length} 저장소, 고른 저장소 ${lines.length}`);
}
mkdirSync('.scratch/explore', { recursive: true });
writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`\n${OUT}: 저장소 ${lines.length}개, PR ${lines.reduce((s, l) => s + JSON.parse(l).prs.length, 0)}개`);

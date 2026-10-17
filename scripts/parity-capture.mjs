// pnpm parity:capture — 공개 testbed PR의 GitHub rich diff를 읽기만 해서 패리티 고정 자료로 저장한다(GitHub에 쓰지 않는다).
// 준비: pnpm e2e:login(크롬 테스트 프로필 로그인)·gh auth login(읽기). 확장 빌드가 md 파일을 렌더링 보기로 바꿔 주므로 그 뒤 확장이 단 것을 걷어 낸다.
// 받는 PR: testbed 시나리오 review·followup과 패리티 PR(parity/head). 결과: packages/engine/test/parity/<이름>/{old.md,new.md,github.html,meta.json}
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from '../testbed/scenarios.ts';
import { PARITY_HEAD } from '../testbed/parity-scenarios.ts';
import { launch } from './mapping-launch.mjs';
import { installPageCss } from './page-css.mjs';

const OUT = 'packages/engine/test/parity';
const TODAY = new Date().toISOString().slice(0, 10);
const MD = /\.(md|markdown|mdx)$/i;
const TARGETS = [
  { key: 'review', head: 'scenario/review' },
  { key: 'followup', head: 'scenario/followup' },
  { key: 'parity', head: PARITY_HEAD },
];
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 << 20 });
const api = (path) => JSON.parse(gh(['api', path]));
const raw = (path, ref) => gh(['api', '-H', 'Accept: application/vnd.github.raw+json', `repos/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`]);
const log = (...a) => console.log('[parity-capture]', ...a);
const [owner] = REPO.split('/');

const context = await launch();
await installPageCss(context); // window.__mdf — src/selectors.ts와 같은 GitHub 가정
const page = context.pages()[0] ?? (await context.newPage());
let saved = 0;
for (const t of TARGETS) {
  const pr = api(`repos/${REPO}/pulls?state=open&head=${owner}:${encodeURIComponent(t.head)}`)[0];
  if (!pr) {
    log(`열린 PR 없음: ${t.head} — 건너뜀`);
    continue;
  }
  const base = api(`repos/${REPO}/compare/${pr.base.sha}...${pr.head.sha}`).merge_base_commit.sha; // GitHub "Files changed"의 세 점 비교
  const files = api(`repos/${REPO}/pulls/${pr.number}/files?per_page=100`).filter((f) => MD.test(f.filename) && f.status !== 'removed' && f.changes > 0);
  await page.goto(`${pr.html_url}/changes`);
  // 확장이 md 파일을 렌더링 보기로 바꿀 때까지 — 아래로 내려 가며 늦게 불러오는 파일도
  const deadline = Date.now() + 90_000;
  let got = {};
  while (Date.now() < deadline) {
    got = await page.evaluate(() => {
      const out = {};
      for (const file of window.__mdf.files()) {
        const prose = file.querySelector('.prose-diff .markdown-body');
        const path = window.__mdf.path(file);
        if (!prose || !path) continue;
        const clone = prose.cloneNode(true);
        // 확장이 단 것을 걷는다(undoAll과 같은 규칙) — GitHub가 그린 그대로만 남긴다
        for (const el of clone.querySelectorAll('[data-mdf]')) el.remove();
        for (const el of clone.querySelectorAll('.mdf-hidden, .mdf-selected, .mdf-flash')) el.classList.remove('mdf-hidden', 'mdf-selected', 'mdf-flash');
        for (const el of clone.querySelectorAll('[data-mdf-pin]')) el.removeAttribute('data-mdf-pin');
        for (const el of clone.querySelectorAll('[class=""]')) el.removeAttribute('class');
        out[path.split('→').pop().trim()] = clone.outerHTML;
      }
      return out;
    });
    if (files.every((f) => got[f.filename])) break;
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1500);
  }
  for (const f of files) {
    const html = got[f.filename];
    if (!html) {
      log(`렌더링을 못 받음: #${pr.number} ${f.filename}`);
      continue;
    }
    const stem = f.filename.replace(MD, '');
    const name = t.key === 'parity' ? stem.split('/').pop() : `${t.key}-${stem.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const dir = join(OUT, name);
    mkdirSync(dir, { recursive: true });
    const status = f.status === 'added' ? 'added' : f.status === 'renamed' ? 'renamed' : 'modified';
    writeFileSync(join(dir, 'old.md'), status === 'added' ? '' : raw(f.previous_filename ?? f.filename, base));
    writeFileSync(join(dir, 'new.md'), raw(f.filename, pr.head.sha));
    writeFileSync(join(dir, 'github.html'), `<!-- source: ${pr.html_url} · captured: ${TODAY} -->\n${html}\n`);
    const meta = { source: pr.html_url, captured: TODAY, path: f.filename, ...(f.previous_filename ? { oldPath: f.previous_filename } : {}), status, base, head: pr.head.sha };
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    saved++;
    log(`저장: ${name} ← #${pr.number} ${f.filename}`);
  }
}
await context.close();
log(`고정 자료 ${saved}개 → ${OUT}`);

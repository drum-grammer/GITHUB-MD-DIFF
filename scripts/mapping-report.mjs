// 실제 PR에서 렌더링 블록이 원문 줄에 얼마나 연결되는지 잰다(읽기만 한다).
// 쓰기: pnpm build && node scripts/mapping-report.mjs <PR changes URL>... — 로그인 프로필(pnpm e2e:login)을 쓴다
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './mapping-launch.mjs';

const out = join(mkdtempSync(join(tmpdir(), 'gmd-map-')), 'entry.mjs');
await build({ entryPoints: ['scripts/mapping-entry.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
const dom = new JSDOM('<!doctype html><body></body>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element });
const lib = await import(out);

const context = await launch();
const page = context.pages()[0] ?? (await context.newPage());
let total = { blocks: 0, mapped: 0 };
for (const url of process.argv.slice(2)) {
  await page.goto(url);
  await page.waitForTimeout(8000); // 확장이 md 파일을 렌더링 보기로 바꿀 시간
  const files = await page.evaluate(async () => {
    const H = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'GitHub-Verified-Fetch': 'true' };
    const route = await (await fetch(location.pathname, { headers: H, credentials: 'include' })).json();
    const [, owner, repo] = location.pathname.split('/');
    const list = [];
    for (const file of document.querySelectorAll('div[id^="diff-"][class*="Diff-module__diff__"], div.file.js-file')) {
      const prose = file.querySelector('.prose-diff .markdown-body');
      const path = (file.querySelector('h3[class*="DiffFileHeader-module__file-name"] code')?.textContent ?? file.querySelector('.file-header[data-path]')?.getAttribute('data-path') ?? '').replace(/[‎‏]/g, '').trim();
      if (!prose || !path) continue;
      list.push({ path: path.split('→').pop().trim(), html: prose.outerHTML });
    }
    const text = async (oid, path) => {
      const r = await fetch(`/${owner}/${repo}/_styled/${oid}/${path.split('/').map(encodeURIComponent).join('/')}`, { headers: H, credentials: 'include' });
      return r.ok ? r.json() : null;
    };
    const full = route.payload.pullRequestsChangesRoute.comparison.fullDiff;
    for (const f of list) {
      f.head = await text(full.headOid, f.path);
      f.base = await text(full.baseOid, f.path);
    }
    return { route, list };
  });
  for (const f of files.list) {
    const doc = new JSDOM(f.html).window.document;
    const body = doc.body.firstElementChild;
    const t0 = performance.now();
    const blocks = lib.domBlocks(body);
    const lines = (j) => (j ? lib.findRawLines(j)?.join('\n') : null);
    const head = lines(f.head);
    const base = lines(f.base);
    const map = lib.mapBlocks(blocks, head == null ? null : lib.sourceBlocks(head), base == null ? null : lib.sourceBlocks(base));
    const ms = performance.now() - t0;
    const by = (side) => {
      const all = blocks.filter((b) => b.side === side);
      return `${all.filter((b) => map.has(b.el)).length}/${all.length}`;
    };
    const miss = blocks.filter((b) => !map.has(b.el)).slice(0, 4).map((b) => `${b.side}:${b.kind}:${b.text.trim().slice(0, 40)}`);
    total.blocks += blocks.length;
    total.mapped += map.size;
    console.log(`${f.path}\n  새 파일 ${by('right')} · 원래 파일 ${by('left')} · ${ms.toFixed(1)}ms${miss.length ? `\n  빠진 예: ${miss.join(' | ')}` : ''}`);
  }
}
console.log(`합계 ${total.mapped}/${total.blocks} (${((100 * total.mapped) / Math.max(1, total.blocks)).toFixed(1)}%)`);
await context.close();

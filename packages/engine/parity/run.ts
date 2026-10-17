/**
 * pnpm parity의 본체 — packages/engine/test/parity/<시나리오>/{old.md,new.md,github.html,meta.json}마다 엔진으로 그려 GitHub와 견주고
 * 보고서(.scratch/parity/report.md)를 쓴다. scripts/parity.mjs가 이 파일을 한 파일로 묶어 돌린다
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { domBlocks, mapBlocks } from '../../../src/dom-blocks';
import { sourceBlocks } from '../../../src/source-blocks';
import { fragment } from '../src/dom';
import { diffMarkdown, renderProseDiff } from '../src/index';
import { buildSide } from '../src/side';
import { wordDiff } from '../src/words';
import { compare, type Comparison, type ParityBlock } from './compare';

export const FIXTURES = 'packages/engine/test/parity';
export const REPORT = '.scratch/parity/report.md';

export interface Meta {
  source: string;
  captured: string;
  path: string;
  oldPath?: string;
  status: 'modified' | 'added' | 'renamed';
}

export interface Fixture {
  name: string;
  meta: Meta;
  oldText: string | null;
  newText: string;
  github: string;
}

export function loadFixtures(dir = FIXTURES): Fixture[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const at = (f: string) => readFileSync(join(dir, d.name, f), 'utf8');
      const meta = JSON.parse(at('meta.json')) as Meta;
      return { name: d.name, meta, oldText: meta.status === 'added' ? null : at('old.md'), newText: at('new.md'), github: at('github.html').replace(/^<!--.*?-->\n/, '') };
    });
}

const show = (b: ParityBlock): string => `${b.mark} ${b.kind} “${b.text.slice(0, 40)}”`;

/** 단어 표시 기준 비율을 정할 자료 — 엔진이 짝지은 문단·제목·항목의 바뀐 비율과, GitHub가 그것을 단어로 냈는지(inline) 통째로 냈는지(whole) */
function wordRows(f: Fixture, github: HTMLElement): string[] {
  if (f.oldText === null) return [];
  const rows: string[] = [];
  const os = buildSide(f.oldText);
  const ns = buildSide(f.newText);
  const d = diffMarkdown({ oldText: f.oldText, newText: f.newText, path: f.meta.path }, { wholeBlockRatio: 1 });
  const gblocks = domBlocks(github);
  for (const b of d.blocks) {
    for (const l of b.leaves) {
      if (l.op !== 'changed' || !['paragraph', 'heading', 'item'].includes(l.leaf.kind) || !l.leaf.old || !l.leaf.new) continue;
      const o = os.leaves.find((x) => x.range.start === l.leaf.old!.start && x.kind === l.leaf.kind);
      const n = ns.leaves.find((x) => x.range.start === l.leaf.new!.start && x.kind === l.leaf.kind);
      if (!o?.el || !n?.el) continue;
      const ratio = wordDiff(o.el, n.el, l.leaf.kind)?.ratio ?? 1;
      const g = gblocks.find((x) => x.side === 'right' && x.text.replace(/\s+/g, ' ').trim() === (n.el!.textContent ?? '').replace(/\s+/g, ' ').trim());
      const how = !g ? 'not found' : g.el.closest('ins') ? 'whole' : 'inline';
      rows.push(`| ${f.name} | ${l.leaf.kind} | ${ratio.toFixed(2)} | ${how} | ${(n.el.textContent ?? '').slice(0, 50).replace(/\|/g, '\\|')} |`);
    }
  }
  return rows;
}

export function run(): { report: string; overall: number; missing: number } {
  const fixtures = loadFixtures();
  const lines: string[] = ['# GitHub 패리티 보고서', '', `만든 때: ${new Date().toISOString()}`, ''];
  const results: Array<[Fixture, Comparison, number]> = [];
  const words: string[] = [];
  let missing = 0;
  let crossDisagree = 0;
  for (const f of fixtures) {
    const diff = diffMarkdown({ oldText: f.oldText, newText: f.newText, path: f.meta.path, oldPath: f.meta.oldPath });
    const engine = fragment(renderProseDiff(diff, { rev: 'parity', imageId: (side, p) => `${side}:${p}` }));
    const github = fragment(f.github);
    const githubBody = (github.querySelector('.markdown-body') as HTMLElement | null) ?? github;
    const blocks = domBlocks(engine);
    const miss = blocks.filter((b) => !b.el.hasAttribute('data-mdc-new') && !b.el.hasAttribute('data-mdc-old')).length;
    missing += miss;
    // 교차 확인 — 확장이 GitHub 화면에서 쓰는 글자 맞추기(mapBlocks)가 엔진의 줄 속성과 같은 줄을 고르는가
    const map = mapBlocks(blocks, sourceBlocks(f.newText), f.oldText === null ? null : sourceBlocks(f.oldText));
    const disagree = blocks.filter((b) => {
      const t = map.get(b.el);
      const attr = b.el.getAttribute(b.side === 'right' ? 'data-mdc-new' : 'data-mdc-old');
      return t !== undefined && attr !== null && attr !== `${t.start}-${t.end}`;
    }).length;
    crossDisagree += disagree;
    results.push([f, compare(githubBody, engine), miss]);
    words.push(...wordRows(f, githubBody));
  }
  // 전체 일치율은 GitHub 포착본만으로 — 손 자료(handmade)는 엔진 모양에 맞춰 쓴 것이라 늘 일치한다(시나리오 표에만 남긴다)
  const captured = results.filter(([f]) => f.meta.source !== 'handmade');
  const total = captured.reduce((s, [, c]) => s + Math.max(c.github.length, c.engine.length), 0);
  const matched = captured.reduce((s, [, c]) => s + c.matched, 0);
  const overall = total ? matched / total : 1;
  lines.push(`**전체 블록 일치율 ${(overall * 100).toFixed(1)}%** (${matched}/${total}, 손 자료 제외 · 포착본 ${captured.length}개) · 줄 속성이 빠진 COMMENT_BLOCK ${missing}개 · mapBlocks 교차 확인 불일치 ${crossDisagree}개`, '');
  lines.push('| 시나리오 | 출처 | GitHub 블록 | 엔진 블록 | 일치 | 일치율 | 표시만 다름 | 줄 속성 빠짐 |', '|---|---|---:|---:|---:|---:|---:|---:|');
  for (const [f, c, miss] of results) lines.push(`| ${f.name} | ${f.meta.source} | ${c.github.length} | ${c.engine.length} | ${c.matched} | ${(c.rate * 100).toFixed(1)}% | ${c.markOnly.length} | ${miss} |`);
  lines.push('', '## 어긋난 블록', '');
  for (const [f, c] of results) {
    if (!c.onlyGithub.length && !c.onlyEngine.length && !c.markOnly.length) continue;
    lines.push(`### ${f.name}`, '');
    for (const [g, e] of c.markOnly) lines.push(`- 표시만 다름: GitHub ${show(g)} · 엔진 ${show(e)}`);
    for (const g of c.onlyGithub) lines.push(`- GitHub에만: ${show(g)}`);
    for (const e of c.onlyEngine) lines.push(`- 엔진에만: ${show(e)}`);
    lines.push('');
  }
  lines.push('## 단어 표시 — 엔진의 바뀐 비율과 GitHub 표시', '', '| 시나리오 | 종류 | 엔진 비율 | GitHub | 새 글 |', '|---|---|---:|---|---|', ...words, '');
  const report = lines.join('\n');
  mkdirSync('.scratch/parity', { recursive: true });
  writeFileSync(REPORT, report);
  return { report, overall, missing };
}

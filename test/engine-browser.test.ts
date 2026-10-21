// 확장 빌드의 엔진 — scripts/build-lib.mjs의 바꿔 끼우기(engineForBrowser)로 묶은 엔진을 jsdom 창에서 그대로 돌린다(docs/local-render §4-2)
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { engineDocument, engineWindow, fragment } from '../src/engine-dom';
import { renderToString } from '../src/engine-math';

type Engine = typeof import('../packages/engine/src/index');
let engine: Engine;
let code: string;

/** esbuild는 jsdom 환경에서 돌지 않는다 — Node 프로세스 하나로 묶어 글자로 받는다 */
const BUNDLE = `
import { build } from 'esbuild';
import { engineForBrowser } from './scripts/build-lib.mjs';
const out = await build({ entryPoints: ['packages/engine/src/index.ts'], bundle: true, format: 'iife', globalName: 'MDCEngine', target: 'chrome120', write: false, plugins: [engineForBrowser], logLevel: 'silent' });
process.stdout.write(out.outputFiles[0].text);
`;

beforeAll(() => {
  code = execFileSync(process.execPath, ['--input-type=module', '-e', BUNDLE], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  engine = new Function(`${code}\nreturn MDCEngine;`)() as Engine;
}, 30_000);

const md = (...xs: string[]): string => xs.join('\n') + '\n';
const html = (oldText: string, newText: string): HTMLElement => {
  const div = document.createElement('div');
  div.innerHTML = engine.renderProseDiff(engine.diffMarkdown({ oldText, newText, path: 'docs/a.md' }), { rev: 'github', imageId: () => null, annotations: false });
  return div;
};

describe('브라우저판 엔진 DOM(src/engine-dom.ts)', () => {
  it('HTML을 읽고 쓰는 문서는 페이지 문서가 아닌 inert 문서다 — 그 안의 이미지는 불러오지 않고 처리기도 돌지 않는다', () => {
    expect(engineDocument()).not.toBe(document);
    expect(engineDocument().defaultView).toBeNull();
    expect(fragment('<img src="x" onerror="boom()">').ownerDocument).toBe(engineDocument());
  });

  it('DOMPurify에 주는 창은 trustedTypes만 감춘다 — GitHub CSP가 막는 정책을 만들지 않게', () => {
    vi.stubGlobal('trustedTypes', { createPolicy: () => ({}) });
    expect((window as unknown as { trustedTypes?: unknown }).trustedTypes).toBeDefined();
    expect((engineWindow() as unknown as { trustedTypes?: unknown }).trustedTypes).toBeUndefined();
    expect(engineWindow().document).toBe(document);
    expect(engineWindow().DOMParser).toBe(window.DOMParser);
    vi.unstubAllGlobals();
  });
});

describe('수식 대역(src/engine-math.ts) — GitHub math-renderer 표기', () => {
  it('인라인·블록, TeX 원문은 escape', () => {
    expect(renderToString('a<b')).toBe('<math-renderer class="js-inline-math" style="display: inline-block">$a&lt;b$</math-renderer>');
    expect(renderToString('T(n)', { displayMode: true })).toBe('<math-renderer class="js-display-math" style="display: block">$$T(n)$$</math-renderer>');
  });
});

describe('확장 빌드로 묶은 엔진', () => {
  it('jsdom·KaTeX가 번들에 없다', () => {
    expect(code).not.toContain('KaTeX parse error');
    expect(code).not.toMatch(/new JSDOM\(/);
  });

  it('수식은 GitHub처럼 math-renderer로, 바뀐 수식은 쪼개지 않고 통째로 바꾼다', () => {
    const b = html(md('Cost is $n^2$ per step.'), md('Cost is $n^3$ per step.'));
    const del = b.querySelector('del math-renderer');
    const ins = b.querySelector('ins math-renderer');
    expect(del?.textContent).toBe('$n^2$');
    expect(ins?.textContent).toBe('$n^3$');
    expect(b.querySelector('math-renderer ins, math-renderer del')).toBeNull();
    expect(b.querySelector('.katex')).toBeNull();
  });

  it('원문 HTML은 정화한다 — 처리기·스크립트가 남지 않고, 렌더링에 안 보이는 원문 변경은 "원문만 바뀜" 막대에 글자로 보인다', () => {
    const b = html(md('Lantern.'), md('Lantern <img src="x" onerror="boom()"> syncs.', '', '<script>boom()</script>'));
    expect(b.querySelector('script')).toBeNull();
    expect(b.querySelectorAll('[onerror]')).toHaveLength(0);
    expect(b.querySelector('.mdc-source-only .mdc-source-diff')!.textContent).toContain('onerror="boom()"');
  });

  it('줄 속성을 달고, 확장 화면 모듈이 읽는 GitHub 표기로 낸다', () => {
    const b = html(md('# Lantern', '', 'Syncs notes.'), md('# Lantern', '', 'Syncs notes and tasks.'));
    const p = b.querySelector('.changed p')!;
    expect(p.getAttribute('data-mdc-new')).toBe('3-3');
    expect(p.querySelector('ins')!.textContent).toContain('and tasks');
  });
});

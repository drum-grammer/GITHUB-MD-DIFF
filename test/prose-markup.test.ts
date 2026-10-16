import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as markup from '../src/prose-markup';
import * as selectors from '../src/selectors';

/** 로컬 리뷰 페이지가 그대로 쓰는 화면 모듈 — GitHub 페이지 껍데기(selectors.ts)와 GitHub 요청(github-api.ts)을 모르게 둔다 */
const REUSED = ['fold', 'table-render', 'nav', 'controls', 'apply', 'dom-blocks', 'comment-ui'];

describe('prose-markup — 렌더링 본문 안 표기', () => {
  it('selectors.ts가 같은 이름을 그대로 다시 내보낸다(같은 값·같은 함수)', () => {
    const names = Object.keys(markup);
    expect(names.sort()).toEqual(
      ['CHANGE_WRAPPER', 'COMMENT_BLOCK', 'HIDDEN_CLASS', 'INLINE_DELETED', 'INLINE_INSERTED', 'MDF_ATTR', 'PIN_ATTR', 'PROSE_BODY', 'REMOVED_BLOCK', 'UNCOLLAPSED_ATTR', 'isAnchor', 'isDecoration', 'isFoldable', 'setHidden', 'tablePairs'].sort(),
    );
    for (const name of names) expect((selectors as Record<string, unknown>)[name], name).toBe((markup as Record<string, unknown>)[name]);
  });

  it('값은 옮기기 전과 같다', () => {
    expect([markup.MDF_ATTR, markup.HIDDEN_CLASS, markup.PIN_ATTR, markup.UNCOLLAPSED_ATTR, markup.PROSE_BODY]).toEqual([
      'data-mdf', 'mdf-hidden', 'data-mdf-pin', 'data-mdf-uncollapsed', '.prose-diff .markdown-body',
    ]);
    expect([markup.COMMENT_BLOCK, markup.REMOVED_BLOCK, markup.INLINE_DELETED, markup.INLINE_INSERTED, markup.CHANGE_WRAPPER]).toEqual([
      'h1, h2, h3, h4, h5, h6, p, li, tr, pre', 'del, .removed', 'del', 'ins', 'ins, del, .added, .removed',
    ]);
  });

  it('prose-markup.ts는 아무것도 import하지 않는다(Node가 selectors.ts를 거쳐 바로 읽는다)', () => {
    expect(readFileSync('src/prose-markup.ts', 'utf8')).not.toMatch(/^\s*import\s/m);
  });

  it('재사용 화면 모듈은 (거쳐서라도) selectors.ts·github-api.ts를 import하지 않는다', () => {
    // 확장자 붙은 꼴('./selectors.ts')과 거쳐 들어오는 import도 본다. import type도 따라간다(Task 3이 화면 모듈의 github-api 타입 import를 types.ts로 옮겼다)
    const seen = new Set<string>();
    const visit = (m: string): void => {
      if (seen.has(m)) return;
      seen.add(m);
      for (const [, dep] of readFileSync(`src/${m}.ts`, 'utf8').matchAll(/^import [^;]*? from '\.\/([\w-]+)(?:\.ts)?';/gm)) visit(dep);
    };
    REUSED.forEach(visit);
    expect([...seen].filter((m) => m === 'selectors' || m === 'github-api')).toEqual([]);
  });

  it('Node가 scripts/page-css.mjs → src/selectors.ts를 바로 읽는다(canary·explore·perf·mapping-report가 쓴다)', () => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', "const m = await import('./scripts/page-css.mjs'); console.log(typeof m.GITHUB_CSS.file)"], { encoding: 'utf8' });
    expect(out.trim()).toBe('string');
  });
});

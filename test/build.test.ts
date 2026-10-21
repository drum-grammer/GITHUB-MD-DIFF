// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_ENTRIES, bundle } from '../scripts/build-lib.mjs';

describe('스토어 빌드', () => {
  it('확장 파일이 다 들어 있고 개발 전용 코드가 없다', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gmd-store-'));
    await bundle({ outdir: out, logLevel: 'silent' });
    expect(readdirSync(out)).toEqual(
      expect.arrayContaining(['manifest.json', 'content.js', 'background.js', 'styles.css', '_locales', 'icons']),
    );
    for (const f of ['content.js', 'background.js']) expect(readFileSync(join(out, f), 'utf8')).not.toContain('dev-build');
  });

  it('로컬 렌더링 엔진은 들어가되 브라우저판 DOM·수식 대역으로 — jsdom·KaTeX는 없다(docs/local-render §4-2)', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gmd-engine-'));
    await bundle({ outdir: out, logLevel: 'silent' });
    const js = readFileSync(join(out, 'content.js'), 'utf8');
    expect(js).toContain('diffMarkdown');
    expect(js).toContain('js-inline-math'); // src/engine-math.ts
    expect(js).toContain('createHTMLDocument'); // src/engine-dom.ts
    expect(js).not.toContain('KaTeX parse error');
    expect(js).not.toMatch(/new JSDOM\(/);
    expect(js.length).toBeLessThan(900_000); // 1.5.1 + #51은 약 331 KB, 엔진을 넣고 약 640 KB(KaTeX를 넣으면 1.5 MB)
  });

  it('개발 빌드에는 자기 갱신 코드와 빌드 번호가 들어간다', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gmd-dev-'));
    await bundle({ outdir: out, entries: DEV_ENTRIES, define: { __DEV_BUILD__: JSON.stringify('1.2.3+abc.x') }, logLevel: 'silent' });
    expect(readFileSync(join(out, 'content.js'), 'utf8')).toContain('1.2.3+abc.x');
    expect(readFileSync(join(out, 'background.js'), 'utf8')).toContain('dev-build.json');
  });
});

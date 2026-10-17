// @vitest-environment node
// esbuild는 jsdom 환경에서 TextEncoder 검사에 걸린다 — 이 파일만 node 환경
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleEngine } from '../build/bundle.mjs';

describe('엔진 단일 파일 번들 — M2 CLI가 묶을 수 있는가', () => {
  it('묶은 파일 하나가 저장소 밖(node_modules 없는 곳)에서 diff를 그린다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mdc-bundle-'));
    const entry = join(dir, 'entry.ts');
    writeFileSync(
      entry,
      `import { diffMarkdown, renderProseDiff } from ${JSON.stringify(resolve('packages/engine/src/index.ts'))};\n` +
        `const d = diffMarkdown({ oldText: 'Value is 3.\\n', newText: 'Value is 4. <script>x</script>\\n', path: 'a.md' });\n` +
        `console.log(renderProseDiff(d, { rev: 'b', imageId: () => null }));\n`,
    );
    const out = join(dir, 'engine.mjs');
    await bundleEngine({ entry, outfile: out, minify: true });
    const html = execFileSync(process.execPath, [out], { cwd: dir, encoding: 'utf8' });
    expect(html).toContain('<del>3</del><ins>4</ins>');
    expect(html).not.toContain('<script');
    console.info(`[bundle] ${(statSync(out).size / 1e6).toFixed(1)}MB`);
  }, 60_000);
});

// @vitest-environment node
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundle } from '../scripts/build-lib.mjs';

describe('스토어 빌드', () => {
  it('확장 파일이 다 들어 있고 개발 전용 코드가 없다', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gmd-store-'));
    await bundle({ outdir: out, logLevel: 'silent' });
    expect(readdirSync(out)).toEqual(
      expect.arrayContaining(['manifest.json', 'content.js', 'background.js', 'styles.css', '_locales', 'icons']),
    );
    for (const f of ['content.js', 'background.js']) expect(readFileSync(join(out, f), 'utf8')).not.toContain('dev-build');
  });
});

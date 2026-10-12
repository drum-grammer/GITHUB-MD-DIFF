import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { branchPlan, checkDemo, latestVersion, listDemos, loadDemo, parseVersionDir, prUrl } from '../scripts/store-demo-lib.mjs';

describe('시연 PR 기록(store/demos)', () => {
  it('저장소의 모든 버전 기록이 검사를 통과한다 — 캡처가 찾는 제목·문단이 head 문서에 있다', () => {
    const dirs = listDemos();
    expect(dirs.length).toBeGreaterThanOrEqual(2);
    for (const dir of dirs) expect(checkDemo(dir), dir).toEqual([]);
  });

  it('가장 높은 버전이 캡처 기본값이고, 기록에는 언어마다 PR 번호가 있다', () => {
    expect(latestVersion(['v1.0.0', 'v1.10.0', 'v1.5.0', 'notes'])).toBe('v1.10.0');
    expect(latestVersion([])).toBeNull();
    expect(parseVersionDir('1.5.0')).toBeNull();
    const latest = loadDemo(latestVersion(listDemos())!);
    expect(latest.langs.en.pr).toBeGreaterThan(0);
    expect(latest.langs.ko.pr).toBeGreaterThan(0);
  });

  it('새 시연은 버전마다 새 브랜치 — 예전 시연을 덮지 않는다', () => {
    expect(branchPlan('1.6.0')).toEqual({ base: 'demo/v1.6.0/base', heads: { en: 'demo/v1.6.0/en', ko: 'demo/v1.6.0/ko' } });
    expect(branchPlan('v1.6.0', ['ko']).heads).toEqual({ ko: 'demo/v1.6.0/ko' });
    expect(prUrl(34)).toBe('https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/34/changes');
  });

  it('잘못된 기록을 잡는다 — 버전 불일치, 빠진 파일, 같은 전·후, head에 없는 제목', () => {
    const root = mkdtempSync(join(tmpdir(), 'demos-'));
    mkdirSync(join(root, 'v2.0.0'));
    const lang = { path: 'demo/a.md', base: 'a.base.md', head: 'a.md', heading: '## Missing', para: 'p', next: 'n', comments: ['x'] };
    writeFileSync(join(root, 'v2.0.0', 'demo.json'), JSON.stringify({ version: '2.0.1', about: 'a', baseBranch: 'b', langs: { en: lang, ko: { ...lang, head: 'nope.md' } } }));
    writeFileSync(join(root, 'v2.0.0', 'a.base.md'), 'same p n');
    writeFileSync(join(root, 'v2.0.0', 'a.md'), 'same p n');
    const problems = checkDemo('v2.0.0', root).join('\n');
    expect(problems).toContain('폴더 이름과 다르다');
    expect(problems).toContain('comments는 2개');
    expect(problems).toContain('base와 head가 같다');
    expect(problems).toContain('heading "## Missing"가 head 문서에 없다');
    expect(problems).toContain('head 파일 nope.md가 없다');
  });
});

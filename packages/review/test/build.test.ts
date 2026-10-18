import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OUT = 'dist/markdown-diff-cat.mjs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
let away = '';

beforeAll(() => {
  execFileSync(process.execPath, ['build.mjs'], { stdio: 'pipe' });
  // 저장소 밖(옆에 node_modules가 없는 곳)에서도 돌아야 런타임 의존이 없는 것이다
  away = mkdtempSync(join(tmpdir(), 'mdc-build-'));
  copyFileSync(OUT, join(away, 'markdown-diff-cat.mjs'));
});
afterAll(() => rmSync(away, { recursive: true, force: true }));

const run = (...args: string[]): string => execFileSync(process.execPath, [join(away, 'markdown-diff-cat.mjs'), ...args], { cwd: away, encoding: 'utf8' });
const assets = (): Record<string, { type: string; bytes: number }> => JSON.parse(readFileSync('dist/assets.json', 'utf8'));

describe('단일 파일 빌드', () => {
  it('저장소 밖에서 --version이 package.json 버전을 낸다', () => {
    expect(run('--version').trim()).toBe(pkg.version);
  });
  it('--help에 명령이 다 있다', () => {
    const help = run('--help');
    for (const cmd of ['review', 'comments', 'wait', 'mark', 'show', 'stop', 'skill install']) expect(help).toContain(cmd);
  });
  it('실행 파일이다(#! 첫 줄, 실행 권한)', () => {
    expect(readFileSync(OUT, 'utf8').startsWith('#!/usr/bin/env node\n')).toBe(true);
    expect(statSync(OUT).mode & 0o111).not.toBe(0);
  });
  it('skill 템플릿과 라이선스 고지를 묶었다', () => {
    expect(assets()['skill.md.tmpl'].type).toBe('text/plain; charset=utf-8');
    expect(assets()['licenses.txt'].bytes).toBeGreaterThan(1000);
  });

  it('페이지 자산이 다 있다 — 번들·CSS·KaTeX CSS와 woff2 폰트·mermaid', () => {
    const list = assets();
    for (const name of ['page.js', 'page.css', 'katex.css', 'mermaid.js']) expect(list[name], name).toBeDefined();
    expect(list['page.css'].type).toBe('text/css; charset=utf-8');
    expect(Object.keys(list).filter((n) => /^fonts\/KaTeX_.+\.woff2$/.test(n)).length).toBeGreaterThanOrEqual(10);
    expect(list['mermaid.js'].bytes).toBeGreaterThan(1_000_000);
  });
  it('라이선스 고지에 github-markdown-css·katex·mermaid가 있다', () => {
    const text = readFileSync('dist/licenses-check.txt', 'utf8');
    for (const name of ['== github-markdown-css@5.9.0 ==', '== katex@', '== mermaid@12.2.0 ==']) expect(text).toContain(name);
  });
  it('크기 예산 10MiB 안이다', () => {
    expect(statSync(OUT).size).toBeLessThanOrEqual(10 * 1024 * 1024);
  });
});

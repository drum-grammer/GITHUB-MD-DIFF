// pnpm 워크스페이스 — 확장(저장소 루트)과 로컬 리뷰 도구(packages/*)를 한 잠금 파일로 묶는다
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('pnpm-workspace.yaml', () => {
  it('저장소 루트와 packages/*를 묶고, esbuild 설치 스크립트는 계속 끈다', () => {
    const yaml = readFileSync('pnpm-workspace.yaml', 'utf8');
    const list = /^packages:\n((?:[ \t]+- .+\n)+)/m.exec(yaml)?.[1] ?? '';
    expect(list.trim().split('\n').map((l) => l.replace(/^\s*-\s*/, ''))).toEqual(['.', 'packages/*']);
    expect(yaml).toMatch(/^allowBuilds:\n[ \t]+esbuild: false$/m);
  });
});

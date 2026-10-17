import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const engine = pkg('packages/engine/package.json');
const root = pkg('package.json');

describe('엔진 패키지', () => {
  it('비공개 ESM 패키지 — 빌드 산출물 없이 TypeScript 소스를 내보낸다(M2 번들이 소스를 import)', () => {
    expect(engine).toMatchObject({ name: '@markdown-diff-cat/engine', private: true, type: 'module', exports: { '.': './src/index.ts' } });
  });

  it('markdown-it·jsdom 판 문자열이 확장 루트와 같다 — 잎(sourceBlocks)과 렌더링이 같은 파서 판을 쓰게', () => {
    expect(engine.dependencies['markdown-it']).toBe(root.dependencies['markdown-it']);
    expect(engine.dependencies.jsdom).toBe(root.devDependencies.jsdom);
  });

  it('플러그인·정화기·줄 diff는 정확한 판으로 고정(스펙 §4-4 1순위)', () => {
    expect(engine.dependencies).toMatchObject({
      '@mdit/plugin-tasklist': '1.1.3',
      'markdown-it-github-alerts': '1.0.1',
      '@mdit/plugin-footnote': '1.1.2',
      '@vscode/markdown-it-katex': '1.1.2',
      'markdown-it-emoji': '3.1.0',
      'github-slugger': '2.0.0',
      dompurify: '3.4.17',
      diff: '8.0.4',
    });
    expect(engine.devDependencies).toEqual({ '@types/jsdom': '30.0.0' });
  });
});

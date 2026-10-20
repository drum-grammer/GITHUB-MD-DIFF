// 빌드가 단일 파일 안에 묶어 둔 자산(페이지 번들·CSS·KaTeX 폰트·mermaid·skill 템플릿·라이선스)을 꺼낸다
import { brotliDecompressSync } from 'node:zlib';
import table from 'virtual:mdc-assets';

export interface Asset {
  type: string;
  body: Buffer;
}

const cache = new Map<string, Asset>();

/** 자산 하나 — 처음 부를 때 한 번 풀어 둔다. 없으면 null */
export function asset(name: string): Asset | null {
  const hit = cache.get(name);
  if (hit) return hit;
  const raw = Object.hasOwn(table, name) ? table[name] : undefined;
  if (!raw) return null;
  const bytes = Buffer.from(raw.b64, 'base64');
  const found: Asset = { type: raw.type, body: raw.br ? brotliDecompressSync(bytes) : bytes };
  cache.set(name, found);
  return found;
}

export function assetNames(): string[] {
  return Object.keys(table).sort();
}

/** skill 템플릿(저장소 skills/markdown-diff-review/SKILL.md.tmpl) */
export function skillTemplate(): string {
  const a = asset('skill.md.tmpl');
  if (!a) throw new Error('the skill template is missing from this build');
  return a.body.toString('utf8');
}

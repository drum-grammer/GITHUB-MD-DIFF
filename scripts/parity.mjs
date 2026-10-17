// pnpm parity — 엔진 HTML을 GitHub rich diff 고정 자료와 블록 단위로 견주고 .scratch/parity/report.md를 쓴다(네트워크 없음).
// 엔진은 TypeScript라 한 파일로 묶어서 돌린다(scripts/mapping-report.mjs와 같은 방식). 고정 자료를 받는 것은 pnpm parity:capture
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundleEngine } from '../packages/engine/build/bundle.mjs';

const out = resolve('.scratch/parity/run.mjs');
mkdirSync('.scratch/parity', { recursive: true });
await bundleEngine({ entry: 'packages/engine/parity/run.ts', outfile: out });
const { run, REPORT } = await import(pathToFileURL(out).href);
const { overall, missing } = run();
console.log(`[parity] 블록 일치율 ${(overall * 100).toFixed(1)}% · 줄 속성 빠짐 ${missing} → ${REPORT}`);

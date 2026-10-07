// mapping-report.mjs·canary.mjs가 jsdom 위에서 부르는 묶음 — 렌더링 블록 ↔ 원문 줄 연결과 PR 데이터 읽기
export { domBlocks, mapBlocks } from '../src/dom-blocks';
export { sourceBlocks } from '../src/source-blocks';
export { parsePrData, findRawLines } from '../src/github-api';

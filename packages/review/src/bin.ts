#!/usr/bin/env node
// 배포 파일의 진입점 — 시험은 cli.ts의 main을 바로 부른다
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) {
  console.error(`markdown-diff-cat needs Node 22 or newer (this is ${process.version})`);
  process.exit(1);
}
const { main, processIo } = await import('./cli');
process.exitCode = await main(process.argv.slice(2), processIo());

// import 문이 없는 파일이라 모듈로 만들어 둔다(맨 위 await) — TS1375
export {};

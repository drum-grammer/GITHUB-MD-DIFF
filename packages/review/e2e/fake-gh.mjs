// E2E용 가짜 gh — 단위 시험의 가짜 GitHub(test/helpers/fake-github.ts)를 그대로 돌린다. 상태는 FAKE_GH_STATE(JSON) 파일에 남는다
// Node 22.18+의 타입 지우기로 .ts를 바로 읽는다(그 파일은 타입만 쓴다)
import { readFileSync, writeFileSync } from 'node:fs';
import { fakeRunner } from '../test/helpers/fake-github.ts';

const file = process.env.FAKE_GH_STATE;
if (!file) {
  process.stderr.write('fake gh: FAKE_GH_STATE is not set\n');
  process.exit(2);
}
const args = process.argv.slice(2);
const gh = JSON.parse(readFileSync(file, 'utf8'));
const input = args.includes('--input') ? readFileSync(0, 'utf8') : undefined;
const r = await fakeRunner(gh)(args, { cwd: process.cwd(), input });
writeFileSync(file, JSON.stringify(gh, null, 2));
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
process.exit(r.code);

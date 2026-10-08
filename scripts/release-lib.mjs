// 스토어 업데이트 하네스의 판단 — 버전·관문·릴리스 노트(입출력 없음, 테스트 대상)
import { LISTING_URL } from './cws.mjs';

export const zipName = (version) => `markdown-diff-cat-for-github-${version}.zip`;
export const recordPath = (version) => `release/release-${version}.json`;
export const notesPath = (version) => `release/notes-${version}.md`;
export const NOTES_DRAFT_MARK = '<!-- 초안: 사람이 읽을 글로 고쳐 쓰고(v1.0.0 노트처럼 영어 + 한국어) 이 줄을 지운 뒤 finish를 다시 -->';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function compareVersions(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  if (!pa || !pb) throw new Error(`SemVer가 아니다: ${pa ? b : a}`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export function latestVersionTag(tags) {
  return tags.filter((t) => t.startsWith('v') && SEMVER.test(t.slice(1))).sort((a, b) => compareVersions(b.slice(1), a.slice(1)))[0] ?? null;
}

export function treeProblems({ head, originMain, porcelain }) {
  const out = [];
  if (head !== originMain) out.push('HEAD가 origin/main이 아니다 — main에 병합된 커밋에서 낸다');
  if (porcelain !== '') out.push('작업 트리가 깨끗하지 않다 — 커밋하거나 치운다');
  return out;
}

export function versionProblems({ manifest, pkg, latestTag, published }) {
  const out = [];
  if (manifest !== pkg) out.push(`버전이 다르다: static/manifest.json ${manifest} · package.json ${pkg}`);
  if (latestTag && compareVersions(manifest, latestTag.slice(1)) <= 0) out.push(`${manifest}은 마지막 태그 ${latestTag}보다 높아야 한다 — 두 파일의 버전을 올린다`);
  if (published && compareVersions(manifest, published) <= 0) out.push(`${manifest}은 스토어 게시 버전 ${published}보다 높아야 한다`);
  return out;
}

export function uploadGate(record, { head, sha256 }) {
  if (!record) return 'release check를 먼저 돌린다(기록 없음)';
  if (record.commit !== head) return `기록의 커밋 ${record.commit.slice(0, 7)} ≠ HEAD ${head.slice(0, 7)} — release check를 다시`;
  if (record.sha256 !== sha256) return 'zip이 기록과 다르다 — release check를 다시';
  return null;
}

export function submitGate(record, { confirm, listingDone }) {
  if (!record) return 'release check를 먼저 돌린다(기록 없음)';
  if (confirm !== record.version) return `제출은 버전을 직접 적는다: --confirm ${record.version}`;
  if (record.upload?.version !== record.version) return `${record.version} 업로드 기록이 없다 — release upload를 먼저`;
  if (record.listingChanged && !listingDone) return '등록정보 글·그림이 지난 태그와 다르다 — pnpm store:upload 도우미로 대시보드 초안에 넣고 저장한 뒤 --listing-done을 붙인다';
  return null;
}

export function finishGate(record, { confirm, published, tags }) {
  if (!record) return 'release check 기록이 없다';
  if (confirm !== record.version) return `태그·릴리스는 버전을 직접 적는다: --confirm ${record.version}`;
  if (published !== record.version) return `스토어 게시 버전이 ${published ?? '없음'}이다 — ${record.version}이 게시된 뒤에 finish`;
  if (tags.includes(`v${record.version}`)) return `태그 v${record.version}이 이미 있다 — 건드리지 않고 멈춘다`;
  return null;
}

/** store/README 제출 기록에서 그 버전 행의 What 칸 */
export function submissionWhat(readme, version) {
  const row = readme.split('\n').find((l) => l.startsWith(`| ${version} |`));
  return row ? row.split(' | ')[2].trim() : null;
}

export function notesDraft({ version, what, sha256 }) {
  return `${NOTES_DRAFT_MARK}
${what}

**Install:** [Chrome Web Store](${LISTING_URL})

## Package

\`${zipName(version)}\` is the exact package uploaded to the Chrome Web Store.

SHA-256: \`${sha256}\`

## 한국어

`;
}

export function notesProblem(notes, sha256) {
  if (notes.includes(NOTES_DRAFT_MARK)) return '릴리스 노트가 아직 초안이다 — 고쳐 쓰고 첫 줄 표시를 지운다';
  if (!notes.includes(sha256)) return '릴리스 노트에 zip SHA-256이 없다';
  return null;
}

export function parseArgs(argv) {
  const [step, ...rest] = argv;
  const i = rest.indexOf('--confirm');
  return { step, confirm: i >= 0 ? rest[i + 1] : undefined, listingDone: rest.includes('--listing-done'), e2e: !rest.includes('--no-e2e') };
}

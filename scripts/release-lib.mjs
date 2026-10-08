// 스토어 업데이트 하네스의 판단 — 버전·관문·릴리스 노트(입출력 없음, 테스트 대상)
import { join, resolve } from 'node:path';
import { LISTING_URL } from './cws.mjs';

export const zipName = (version) => `markdown-diff-cat-for-github-${version}.zip`;
/** 릴리스 노트 — 제출 전에 쓰고 저장소에 둔다(docs/releases/). finish는 origin/main의 이 파일로 GitHub Release를 만든다 */
export const releaseNotesPath = (version) => `docs/releases/v${version}.md`;

/**
 * 버전마다 기록(record.json)·스토어에 올린 zip·릴리스 노트(notes.md)를 두는 폴더. 심사는 며칠~몇 주라 finish는 다른 세션에서 돈다 —
 * 세션 worktree의 release/는 그때 없으므로 저장소 밖 고정 폴더에 둔다(GMD_RELEASE_DIR로 바꿈)
 */
export function releaseDir(env, home, version) {
  return resolve(env.GMD_RELEASE_DIR || join(home, '.local', 'share', 'github-md-diff', 'releases'), version);
}
export const NOTES_DRAFT_MARK = '<!-- 초안: 사람이 읽을 글로 고쳐 쓰고(v1.1.1 노트처럼 영어 + 한국어) 이 줄을 지운 뒤 main에 병합 -->';
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

/** check가 기록을 덮어써도 되는가 — 이미 스토어에 올린 기록은 --redo 없이 덮지 않는다(올린 zip과 태그할 커밋이 어긋난다) */
export function checkGate(existing, { redo }) {
  if (existing?.upload && !redo) return `${existing.version}을 이미 스토어에 올린 기록이 있다(커밋 ${existing.commit.slice(0, 7)}) — 같은 버전을 다시 낼 때만 --redo(옛 기록은 보관)`;
  return null;
}

export function uploadGate(record, { zipSha }) {
  if (!record) return 'release check를 먼저 돌린다(기록 없음)';
  if (zipSha !== record.sha256) return 'zip이 기록과 다르다 — release check를 다시';
  if (record.submit) return `${record.version}은 이미 제출했다 — 다시 낼 때는 release check --redo`;
  return null;
}

export function submitGate(record, { confirm, listingDone, zipSha }) {
  if (!record) return 'release check를 먼저 돌린다(기록 없음)';
  if (confirm !== record.version) return `제출은 버전을 직접 적는다: --confirm ${record.version}`;
  if (record.submit) return `${record.version}은 이미 제출했다 — pnpm release status로 확인`;
  if (record.upload?.version !== record.version || record.upload?.sha256 !== record.sha256) return `${record.version} 업로드 기록이 없다 — release upload를 먼저`;
  if (zipSha !== record.sha256) return 'zip이 스토어에 올린 것과 다르다 — 멈춘다';
  if (record.listingChanged && !listingDone) return '등록정보 글·그림이 지난 태그와 다르다 — pnpm store:upload 도우미로 대시보드 초안에 넣고 저장한 뒤 --listing-done을 붙인다';
  return null;
}

export function finishGate(record, { confirm, published, zipSha }) {
  if (!record) return '이 버전의 릴리스 기록이 없다 — release check·upload·submit을 한 기기에서 한다';
  if (confirm !== record.version) return `태그·릴리스는 버전을 직접 적는다: --confirm ${record.version}`;
  if (!record.submit) return `${record.version} 제출 기록이 없다 — 이 기록으로 낸 패키지가 아니다`;
  if (record.upload?.sha256 !== record.sha256 || zipSha !== record.sha256) return 'zip이 스토어에 올린 것과 다르다 — 멈춘다';
  if (published !== record.version) return `스토어 게시 버전이 ${published ?? '없음'}이다 — ${record.version}이 게시된 뒤에 finish`;
  return null;
}

/** 태그를 새로 만들지, 지난 finish가 만든 것을 이어 쓸지. 다른 커밋을 가리키는 태그는 건드리지 않는다 */
export function tagPlan({ existingTagCommit, recordCommit }) {
  if (existingTagCommit === null) return { action: 'create' };
  if (existingTagCommit === recordCommit) return { action: 'reuse' };
  return { problem: `태그가 이미 다른 커밋(${existingTagCommit.slice(0, 7)})에 있다 — 건드리지 않고 멈춘다` };
}

/** 노트 뼈대 — 설치 링크와 패키지 절(커밋·zip SHA-256)만 채운다. 바뀐 것·시험한 것은 사람이 쓴다 */
export function notesDraft({ version, commit, sha256 }) {
  return `${NOTES_DRAFT_MARK}
What changed in ${version}, in one or two sentences.

**Install or update:** [Chrome Web Store](${LISTING_URL})

## New

## Fixed

## Package

\`${zipName(version)}\` is the exact package uploaded to the Chrome Web Store, built from \`${commit.slice(0, 7)}\`. A rebuild from this tag has the same contents.

SHA-256: \`${sha256}\`

## 한국어

`;
}

export function notesProblem(notes, sha256) {
  if (notes.includes(NOTES_DRAFT_MARK)) return '릴리스 노트가 아직 초안이다 — 고쳐 쓰고 첫 줄 표시를 지워 main에 병합한다';
  if (!notes.includes(sha256)) return '릴리스 노트에 이 기록의 zip SHA-256이 없다 — 패키지를 다시 만들었으면 노트의 Package 절을 고친다';
  return null;
}

export function parseArgs(argv) {
  const [step, ...rest] = argv;
  const i = rest.indexOf('--confirm');
  return {
    step,
    confirm: i >= 0 ? rest[i + 1] : undefined,
    listingDone: rest.includes('--listing-done'),
    e2e: !rest.includes('--no-e2e'),
    redo: rest.includes('--redo'),
  };
}

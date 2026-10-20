// npm 패키지 markdown-diff-cat 릴리스의 판단(입출력 없음, 테스트 대상) — 확장 스토어 하네스(release-lib.mjs)와 같은 모양
export const PKG_DIR = 'packages/review';
export const BUILT = 'packages/review/dist/markdown-diff-cat.mjs';
/** npm pack이 싣는 파일 — package.json은 npm이 늘 싣는다 */
export const PACK_FILES = ['LICENSE', 'README.md', 'dist/markdown-diff-cat.mjs', 'package.json'];
export const SIZE_LIMIT = 10 * 1024 * 1024;
export const assetName = (version) => `markdown-diff-cat-${version}.mjs`;

export function versionsProblems({ root, manifest, review }) {
  if (root === manifest && root === review) return [];
  return [`버전이 셋 다 같아야 한다: package.json ${root} · static/manifest.json ${manifest} · packages/review/package.json ${review} — 확장과 같은 번호로 낸다`];
}

const PUBLISHED_KEYS = ['name', 'version', 'description', 'type', 'bin', 'files', 'engines', 'license', 'repository', 'homepage', 'bugs', 'keywords'];

/** npm에 올릴 package.json — 개발용(scripts·devDependencies)은 뺀다. devDependencies의 workspace:*가 바깥에 실리지 않게 */
export function publishManifest(pkg) {
  return Object.fromEntries(PUBLISHED_KEYS.filter((k) => pkg[k] !== undefined).map((k) => [k, pkg[k]]));
}

export function manifestProblems(pkg) {
  const out = [];
  if (pkg.name !== 'markdown-diff-cat') out.push(`이름이 markdown-diff-cat이 아니다: ${pkg.name}`);
  if (pkg.private) out.push('private가 있다 — npm에 낼 수 없다');
  const deps = Object.keys(pkg.dependencies ?? {});
  if (deps.length) out.push(`런타임 dependencies가 있다(모두 번들에 넣어야 한다): ${deps.join(', ')}`);
  if (JSON.stringify(publishManifest(pkg)).includes('workspace:')) out.push('게시할 package.json에 workspace: 글자가 남았다');
  return out;
}

/** `npm pack --dry-run --json` 결과 하나 → 문제 */
export function packProblems(pack) {
  const files = pack.files.map((f) => f.path).sort();
  const want = [...PACK_FILES].sort();
  const out = [];
  if (JSON.stringify(files) !== JSON.stringify(want)) out.push(`패키지 파일이 다르다: ${files.join(', ')} (기대: ${want.join(', ')})`);
  if (pack.unpackedSize > SIZE_LIMIT) out.push(`패키지가 크다: ${pack.unpackedSize} bytes > ${SIZE_LIMIT}`);
  return out;
}

export function npmGate({ version, published }) {
  return published.includes(version) ? `npm에 markdown-diff-cat@${version}이 이미 있다 — 같은 번호는 다시 낼 수 없다(다음 버전으로)` : null;
}

export function attachGate(record, { confirm, builtSha, releaseExists, assets }) {
  if (!record) return 'release-review check를 먼저 돌린다(기록 없음)';
  if (confirm !== record.version) return `붙이기는 버전을 직접 적는다: --confirm ${record.version}`;
  if (builtSha !== record.sha256) return '빌드한 파일이 check 때와 다르다 — check를 다시';
  if (!releaseExists) return `GitHub Release v${record.version}가 없다 — 확장 pnpm release finish가 먼저`;
  if (assets.includes(assetName(record.version))) return `${assetName(record.version)}가 이미 붙어 있다 — 건드리지 않고 멈춘다`;
  return null;
}

export function publishGate(record, { confirm, builtSha, stagedSha, published }) {
  if (!record) return 'release-review check를 먼저 돌린다(기록 없음)';
  if (confirm !== record.version) return `게시는 버전을 직접 적는다: --confirm ${record.version}`;
  if (!record.attach) return `${assetName(record.version)}를 Release에 먼저 붙인다 — release-review attach`;
  if (builtSha !== record.sha256) return '빌드한 파일이 check 때와 다르다 — 멈춘다';
  if (stagedSha !== record.sha256) return '게시용 폴더의 파일이 check 때와 다르다 — check를 다시';
  return npmGate({ version: record.version, published });
}

/** 붙일·게시할 파일은 확장 릴리스 태그 vX.Y.Z와 같은 커밋에서 빌드한다 — 확장 기록(record.json)의 commit이 그 태그다(pnpm release finish가 그 커밋에 태그를 단다) */
export function commitGate({ head, releaseCommit, porcelain }) {
  if (!releaseCommit) return '확장 릴리스 기록(record.json)이 없다 — 같은 기기에서 확장 pnpm release check부터';
  if (head !== releaseCommit) return `HEAD(${head.slice(0, 7)})가 확장 릴리스 커밋(${releaseCommit.slice(0, 7)} = 태그)이 아니다 — git switch --detach ${releaseCommit} && pnpm install --frozen-lockfile 뒤 다시`;
  if (porcelain !== '') return '작업 트리가 깨끗하지 않다 — 커밋하거나 치운다';
  return null;
}

/** GitHub에서 읽는 README의 "아직 npm에 없음" 안내(<!-- pre-npm --> … <!-- /pre-npm -->) — npm에 싣는 사본에서는 뺀다 */
export function npmReadme(text) {
  return text.replace(/<!-- pre-npm -->[\s\S]*?<!-- \/pre-npm -->\n*/g, '');
}

export function parseReviewArgs(argv) {
  const [step, ...rest] = argv;
  const i = rest.indexOf('--confirm');
  return { step, confirm: i >= 0 ? rest[i + 1] : undefined };
}

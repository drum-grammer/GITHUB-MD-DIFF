// git 읽기만 — 작업 트리 모드는 .git에 아무것도 쓰지 않는다(옵션 잠금 끔: 색인 새로 고침도 하지 않는다)
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { similarity } from '../../../src/align';

export type GitErrorCode = 'not-a-repo' | 'bare' | 'no-default-branch' | 'unknown-ref' | 'shallow' | 'no-merge-base' | 'git-failed';

export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** git을 셸 없이 부른다. 경로는 따옴표·8진수 없이(core.quotePath=false), 옵션 잠금 없이(--no-optional-locks) */
export function git(cwd: string, args: string[], input?: string): Buffer {
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.quotePath=false', ...args], {
    cwd,
    input,
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
  });
}

export const gitText = (cwd: string, args: string[], input?: string): string => git(cwd, args, input).toString('utf8').trim();

/** 실패하면 null — 있는지 볼 때만 쓴다 */
export function tryGit(cwd: string, args: string[]): string | null {
  try {
    return gitText(cwd, args);
  } catch {
    return null;
  }
}

export interface RepoInfo {
  /** 작업 트리 최상위(realpath) */
  root: string;
  /** 공통 git 폴더(realpath) — 연결 worktree끼리 같다 */
  commonDir: string;
  shallow: boolean;
  /** 첫 커밋 전이면 null */
  headOid: string | null;
}

export function repoInfo(cwd: string): RepoInfo {
  const bare = tryGit(cwd, ['rev-parse', '--is-bare-repository']);
  if (bare === null) throw new GitError('not-a-repo', 'not a git repository — run it inside a working tree');
  if (bare === 'true') throw new GitError('bare', 'this is a bare repository — run it inside a working tree');
  if (tryGit(cwd, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    throw new GitError('not-a-repo', 'run it inside the working tree, not inside the .git folder');
  }
  const [root, commonDir, shallow] = gitText(cwd, ['rev-parse', '--show-toplevel', '--git-common-dir', '--is-shallow-repository']).split('\n');
  return {
    root: realpathSync.native(root),
    commonDir: realpathSync.native(resolve(cwd, commonDir)),
    shallow: shallow === 'true',
    headOid: tryGit(cwd, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']),
  };
}

/** 이 저장소 형식(SHA-1·SHA-256)의 빈 트리 */
export function emptyTree(cwd: string): string {
  return gitText(cwd, ['hash-object', '-t', 'tree', '--stdin'], '');
}

const verify = (root: string, ref: string): boolean => tryGit(root, ['rev-parse', '-q', '--verify', `${ref}^{commit}`]) !== null;
const remotes = (root: string): string[] => gitText(root, ['remote']).split('\n').filter(Boolean);
const shortRef = (ref: string): string => ref.replace(/^refs\/remotes\//, '').replace(/^refs\/heads\//, '');

/**
 * 기본 브랜치 — origin/HEAD가 가리키는 원격 추적 브랜치 → origin/main → origin/master. 원격이 없을 때만 로컬 main·master.
 * 로컬 main은 뒤처져 있으면 남의 md 변경까지 섞이므로 원격 추적 브랜치를 먼저 쓴다(스펙 §5-3)
 */
export function defaultBranchRef(root: string): string {
  const head = tryGit(root, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']);
  if (head && verify(root, head)) return head;
  for (const name of ['main', 'master']) if (verify(root, `refs/remotes/origin/${name}`)) return `refs/remotes/origin/${name}`;
  if (remotes(root).length === 0) {
    for (const name of ['main', 'master']) if (verify(root, `refs/heads/${name}`)) return `refs/heads/${name}`;
  }
  throw new GitError('no-default-branch', 'could not find the default branch (no origin/HEAD, origin/main, or origin/master) — pass --base <ref>');
}

/** upstream 원격이 있으면 포크 작업 흐름에 권할 기준(upstream/main 등) */
function upstreamHint(root: string): string | null {
  if (!remotes(root).includes('upstream')) return null;
  const head = tryGit(root, ['symbolic-ref', '-q', 'refs/remotes/upstream/HEAD']);
  if (head) return shortRef(head);
  for (const name of ['main', 'master']) if (verify(root, `refs/remotes/upstream/${name}`)) return `upstream/${name}`;
  return null;
}

export interface BaseInfo {
  /** 분기점 커밋 OID, 첫 커밋 전이면 빈 트리 OID */
  oid: string;
  /** 넘기기 머리 줄의 괄호 안: "merge-base origin/main" */
  label: string;
  ref: string | null;
  /** 분기점이 HEAD — 커밋 안 한 변경만 보인다(의도된 동작) */
  headIsBase: boolean;
  upstream: string | null;
}

export function resolveBase(repo: RepoInfo, baseRef?: string): BaseInfo {
  const upstream = upstreamHint(repo.root);
  if (!repo.headOid) return { oid: emptyTree(repo.root), label: 'empty tree — no commits yet', ref: null, headIsBase: false, upstream };
  const ref = baseRef ?? defaultBranchRef(repo.root);
  if (!verify(repo.root, ref)) throw new GitError('unknown-ref', `unknown ref: ${ref}`);
  const oid = tryGit(repo.root, ['merge-base', 'HEAD', ref]);
  if (!oid) {
    if (repo.shallow) throw new GitError('shallow', `no merge base with ${shortRef(ref)} in this shallow clone — run git fetch --deepen=100 (or git fetch --unshallow) and try again`);
    throw new GitError('no-merge-base', `${shortRef(ref)} has no common ancestor with HEAD — pass --base <ref>`);
  }
  return { oid, label: `merge-base ${shortRef(ref)}`, ref, headIsBase: oid === repo.headOid, upstream };
}

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
}

export interface ListedFile extends ChangedFile {
  /** git이 추적하지 않는 새 파일(ls-files --others) */
  untracked?: true;
}

export const MD_PATH = /\.(md|markdown|mdx)$/i;
export const isMarkdown = (path: string): boolean => MD_PATH.test(path);

/** `git diff -z --name-status` 출력 → 바뀐 파일. 이름 바꿈(R)·복사(C)는 경로 둘이 따라온다. T(형식)·U(병합 중)는 수정으로 본다 */
export function parseNameStatus(raw: string): ChangedFile[] {
  const parts = raw.split('\0');
  const out: ChangedFile[] = [];
  let i = 0;
  while (i < parts.length) {
    const code = parts[i++];
    if (!code) continue;
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = parts[i++];
      const path = parts[i++];
      out.push(kind === 'R' ? { path, oldPath, status: 'renamed' } : { path, status: 'added' });
    } else {
      const path = parts[i++];
      out.push({ path, status: kind === 'A' ? 'added' : kind === 'D' ? 'deleted' : 'modified' });
    }
  }
  return out;
}

/** 분기점과 다른 md — 추적 중인 것(git diff, 이름 바꿈 판정 포함)과 추적 안 하는 새 md. 짝짓기 전 목록(폴링 지문은 이것만 본다) */
export function listMarkdown(root: string, baseOid: string): ListedFile[] {
  const tracked = parseNameStatus(git(root, ['diff', '-z', '--name-status', '-M', baseOid, '--']).toString('utf8')).filter(
    (f) => isMarkdown(f.path) || (f.oldPath !== undefined && isMarkdown(f.oldPath)),
  );
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard'])
    .toString('utf8')
    .split('\0')
    .filter((p) => p && isMarkdown(p))
    .map((path): ListedFile => ({ path, status: 'added', untracked: true }));
  return [...tracked, ...untracked];
}

export const RENAME_SIMILARITY = 0.5;
/** 지운 수 × 추가 수가 이보다 많으면 짝짓지 않는다(내용 비교가 길어지지 않게) */
const MAX_RENAME_PAIRS = 2500;

const strip = (f: ChangedFile): ChangedFile => ({ path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}), status: f.status });
const byPath = (a: ChangedFile, b: ChangedFile): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * 지운 파일과 새 파일을 내용 유사도(확장 align.ts의 similarity, 0.5 이상)로 한 번 더 짝지어 이름 바꿈으로 본다.
 * 에이전트가 그냥 mv한 파일은 git에게 "삭제 + 추적 안 하는 새 파일"로 보이기 때문이다(스펙 §5-3). 점수가 높은 짝부터 겹치지 않게
 */
export function pairRenames<T extends ChangedFile>(files: T[], canPair: (f: T) => boolean, text: (side: 'old' | 'new', path: string) => string | null): ChangedFile[] {
  const gone = files.filter((f) => f.status === 'deleted' && canPair(f));
  const born = files.filter((f) => f.status === 'added' && canPair(f));
  const out: ChangedFile[] = files.filter((f) => !gone.includes(f) && !born.includes(f)).map(strip);
  const pairs: Array<{ a: T; b: T; score: number }> = [];
  if (gone.length * born.length <= MAX_RENAME_PAIRS) {
    const bornText = born.map((b) => text('new', b.path));
    for (const a of gone) {
      const ta = text('old', a.path);
      if (ta === null) continue;
      born.forEach((b, j) => {
        const tb = bornText[j];
        if (tb === null) return;
        const score = similarity(ta, tb);
        if (score >= RENAME_SIMILARITY) pairs.push({ a, b, score });
      });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const used = new Set<T>();
  for (const { a, b } of pairs) {
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    out.push({ path: b.path, oldPath: a.path, status: 'renamed' });
  }
  for (const f of [...gone, ...born]) if (!used.has(f)) out.push(strip(f));
  return out.sort(byPath);
}

/** 분기점과 다른 md — 그냥 mv한 파일까지 이름 바꿈으로 짝지은 것 */
export function changedMarkdown(root: string, baseOid: string): ChangedFile[] {
  const listed = listMarkdown(root, baseOid);
  const text = (side: 'old' | 'new', path: string): string | null => {
    if (side === 'old') return readTextAt(root, baseOid, path);
    const r = readWorktree(root, path);
    return r.kind === 'text' || r.kind === 'symlink' ? r.text : null;
  };
  return pairRenames(listed, (f) => f.status === 'deleted' || f.untracked === true, text);
}

/** 기준 커밋(또는 빈 트리)의 원문 바이트 — 없으면 null. `git show <oid>:<path>`는 blob에 textconv를 걸지 않는다 */
export function readAt(root: string, oid: string, path: string): Buffer | null {
  if (tryGit(root, ['cat-file', '-e', `${oid}:${path}`]) === null) return null;
  return git(root, ['show', `${oid}:${path}`]);
}

export function readTextAt(root: string, oid: string, path: string): string | null {
  const bytes = readAt(root, oid, path);
  return bytes === null ? null : bytes.toString('utf8');
}

export type WorktreeRead =
  | { kind: 'text'; text: string }
  | { kind: 'symlink'; text: string }
  | { kind: 'missing' }
  | { kind: 'refused'; reason: 'outside-repo' | 'git-dir' | 'not-a-file' };

/**
 * 작업 트리 파일 — lstat부터. 심링크는 따라가지 않고 링크 대상 글자만 돌려준다(git이 보여 주는 것과 같다).
 * 보통 파일도 realpath가 저장소 안·.git 밖일 때만 읽는다 — 신뢰하지 못하는 브랜치의 링크로 비밀이 화면·인용에 실리지 않게(스펙 §5-3)
 */
export function readWorktree(root: string, path: string): WorktreeRead {
  const abs = join(root, path);
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return { kind: 'missing' };
  }
  if (st.isSymbolicLink()) return { kind: 'symlink', text: readlinkSync(abs) };
  if (!st.isFile()) return { kind: 'refused', reason: 'not-a-file' };
  const where = insideRepo(root, abs);
  if (where !== 'inside') return { kind: 'refused', reason: where };
  return { kind: 'text', text: readFileSync(abs, 'utf8') };
}

/** realpath가 저장소 최상위 안인가. 경로 구간은 대소문자를 접어 .git을 본다(macOS에서는 .GIT도 같은 폴더다) */
export function insideRepo(root: string, abs: string): 'inside' | 'outside-repo' | 'git-dir' {
  let real: string;
  try {
    real = realpathSync.native(abs);
  } catch {
    return 'outside-repo';
  }
  const rel = relative(realpathSync.native(root), real);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return 'outside-repo';
  if (rel.split(sep).some((seg) => seg.toLowerCase() === '.git')) return 'git-dir';
  return 'inside';
}

// git 읽기만 — 작업 트리 모드는 .git에 아무것도 쓰지 않는다(옵션 잠금 끔: 색인 새로 고침도 하지 않는다)
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

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

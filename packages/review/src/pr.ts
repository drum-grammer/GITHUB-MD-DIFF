// PR 모드의 내용(스펙 §6-1) — gh pr view로 확정한 OID를 git fetch로 refs/markdown-diff-cat/pr/<n>/*에 받아 git 객체에서만 읽는다.
// 사용자의 작업 트리·브랜치·HEAD는 바꾸지 않는다. 받은 ref는 stop --clean이 지운다
import { execFileSync } from 'node:child_process';
import { CliError } from './errors';
import type { PrView } from './gh';
import { GitError, git, gitText, isMarkdown, parseNameStatus, readTextAt, tryGit } from './git';
import type { PrRef } from './records';
import type { ViewFile } from './views';

const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/([1-9]\d*)(?:[/?#].*)?$/;
export const REF_ROOT = 'refs/markdown-diff-cat/';

/** --pr의 값 — 번호 또는 github.com PR 주소(뒤의 /files·?…·#…는 뗀다) */
export function parsePrRef(arg: string): string {
  if (/^[1-9]\d*$/.test(arg)) return arg;
  const m = PR_URL.exec(arg);
  if (m) return `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`;
  throw new CliError(2, '--pr takes a pull request number or a https://github.com/<owner>/<repo>/pull/<number> URL');
}

/** 원격 주소가 그 GitHub 저장소인가 — https·scp 모양 ssh·ssh:// 셋, .git·끝 / 있어도, 대소문자 무시 */
function sameRepo(url: string, owner: string, repo: string): boolean {
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m !== null && m[1].toLowerCase() === owner.toLowerCase() && m[2].toLowerCase() === repo.toLowerCase();
}

/**
 * 그 base 저장소를 가리키는 원격 이름 — insteadOf를 적용하기 전의 설정값으로 본다.
 * 포크 작업 흐름에서는 origin이 포크라서 origin의 pull/N/head가 엉뚱한 PR이기 때문이다
 */
export function pickRemote(root: string, owner: string, repo: string): string | null {
  const raw = tryGit(root, ['config', '--get-regexp', '^remote\\..*\\.url$']) ?? '';
  for (const line of raw.split('\n')) {
    const m = /^remote\.(.+)\.url (.+)$/.exec(line);
    if (m && sameRepo(m[2], owner, repo)) return m[1];
  }
  return null;
}

/** fetch만 쓰기(받은 ref) — 자격 증명 질문으로 멈추지 않게 터미널 프롬프트를 끈다 */
function fetch(root: string, source: string, refspecs: string[]): void {
  execFileSync('git', ['-c', 'core.quotePath=false', 'fetch', '--no-tags', '--no-recurse-submodules', '--quiet', source, ...refspecs], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
  });
}

const hasCommit = (root: string, oid: string): boolean => tryGit(root, ['cat-file', '-e', `${oid}^{commit}`]) !== null;
const stderrOf = (e: unknown): string => ((e as { stderr?: Buffer }).stderr?.toString('utf8') ?? (e as Error).message).trim();

/** PR의 head·base를 받아 OID와 분기점을 확정한다. head가 PR 응답과 다르면(사이에 새 커밋) 그 OID로 한 번 더 받는다 */
export function fetchPr(root: string, view: PrView): PrRef {
  const { owner, repo, number } = view;
  const source = pickRemote(root, owner, repo) ?? `https://github.com/${owner}/${repo}.git`;
  const headRef = `${REF_ROOT}pr/${number}/head`;
  const baseRef = `${REF_ROOT}pr/${number}/base`;
  const fail = (e: unknown): never => {
    throw new GitError('git-failed', `could not fetch ${owner}/${repo}#${number} from ${source}: ${stderrOf(e)}`);
  };
  try {
    fetch(root, source, [`+refs/pull/${number}/head:${headRef}`, `+refs/heads/${view.baseRefName}:${baseRef}`]);
  } catch (e) {
    fail(e);
  }
  for (const [oid, ref] of [
    [view.headRefOid, headRef],
    [view.baseRefOid, baseRef],
  ] as const) {
    if (gitText(root, ['rev-parse', ref]) === oid && hasCommit(root, oid)) continue;
    try {
      fetch(root, source, [`+${oid}:${ref}`]);
    } catch (e) {
      fail(e);
    }
    if (!hasCommit(root, oid)) fail(new Error(`${oid} is not in the fetched refs`));
  }
  const mergeBase = tryGit(root, ['merge-base', view.baseRefOid, view.headRefOid]);
  if (!mergeBase) throw new GitError('no-merge-base', `${owner}/${repo}#${number}: the head has no common ancestor with ${view.baseRefName}`);
  return { owner, repo, number, url: view.url, title: view.title, baseOid: view.baseRefOid, headOid: view.headRefOid, mergeBase };
}

/** PR의 md — 옛 쪽은 분기점, 새 쪽은 head의 git 객체(작업 트리는 읽지 않는다). 형식만 바뀐 것은 뺀다 */
export function prFiles(root: string, pr: PrRef): ViewFile[] {
  const changed = parseNameStatus(git(root, ['diff', '-z', '--name-status', '-M', pr.mergeBase, pr.headOid, '--']).toString('utf8')).filter(
    (f) => isMarkdown(f.path) || (f.oldPath !== undefined && isMarkdown(f.oldPath)),
  );
  const out: ViewFile[] = [];
  for (const f of changed) {
    const oldText = f.status === 'added' ? null : readTextAt(root, pr.mergeBase, f.oldPath ?? f.path);
    const newText = f.status === 'deleted' ? null : readTextAt(root, pr.headOid, f.path);
    if (f.status === 'modified' && oldText === newText) continue;
    out.push({ ...f, oldText, newText });
  }
  return out;
}

/** refs/markdown-diff-cat/ 아래 ref를 모두 지운다 — 지운 ref 이름(정렬) */
export function cleanPrRefs(root: string): string[] {
  const refs = (tryGit(root, ['for-each-ref', '--format=%(refname)', REF_ROOT]) ?? '').split('\n').filter(Boolean).sort();
  for (const ref of refs) gitText(root, ['update-ref', '-d', ref]);
  return refs;
}

/** 에이전트가 고칠 작업 트리가 PR head가 아니면 줄 번호가 맞지 않는다(스펙 §6-4) — 넘기기 머리와 페이지 알림에 쓴다 */
export function checkoutWarning(root: string, pr: PrRef, paths: string[]): string | null {
  const name = `${pr.owner}/${pr.repo}#${pr.number}`;
  const head = pr.headOid.slice(0, 7);
  if (tryGit(root, ['rev-parse', '-q', '--verify', 'HEAD^{commit}']) !== pr.headOid) {
    return `HEAD is not the head of ${name} (${head}) — line numbers refer to the pull request head. Run gh pr checkout ${pr.number} before editing.`;
  }
  if (paths.length && git(root, ['status', '--porcelain', '-z', '--', ...paths]).length > 0) {
    return `The working tree has changes in files of ${name} — line numbers refer to the pull request head (${head}).`;
  }
  return null;
}

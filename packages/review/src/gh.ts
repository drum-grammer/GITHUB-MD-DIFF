// GitHub CLI(gh) — PR 모드의 GitHub 요청은 모두 여기를 거친다(스펙 §6-3). 셸 없이 부르고, 사람이 쓴 글은 stdin JSON(--input -)으로만 넘긴다.
// -F·-f에 사용자 글을 넣지 않는다(-F는 @로 시작하는 값을 파일로 읽는다). 토큰은 gh가 맡고 우리는 읽지도 저장하지도 않는다
import { execFile } from 'node:child_process';

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GhRunner = (args: string[], opts: { cwd: string; input?: string }) => Promise<GhResult>;

/** 실제 gh — gh가 없으면(ENOENT) code 127 */
export const runGh: GhRunner = (args, opts) =>
  new Promise((done) => {
    const child = execFile(
      'gh',
      args,
      { cwd: opts.cwd, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' } },
      (err, stdout, stderr) => {
        const code = err ? ((err as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : typeof err.code === 'number' ? err.code : 1) : 0;
        done({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    child.stdin?.end(opts.input ?? '');
  });

export type GhErrorKind = 'missing' | 'auth' | 'failed';

export class GhError extends Error {
  constructor(
    readonly kind: GhErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export const MISSING_GH = 'PR mode needs the GitHub CLI (gh): https://cli.github.com';

/** owner·repo 이름 — {owner} 같은 gh 자리표시자도 걸러진다 */
export const NAME = /^[A-Za-z0-9._-]+$/;

export function repoPath(owner: string, repo: string, rest: string): string {
  if (!NAME.test(owner) || !NAME.test(repo)) throw new GhError('failed', `not a GitHub repository name: ${owner}/${repo}`);
  return `repos/${owner}/${repo}/${rest}`;
}

export interface PrView {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  baseRefName: string;
  baseRefOid: string;
  headRefOid: string;
}

const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)$/;

export class Gh {
  constructor(
    private readonly run: GhRunner,
    readonly cwd: string,
  ) {}

  private async call(args: string[], input?: string): Promise<string> {
    const r = await this.run(args, { cwd: this.cwd, input });
    if (r.code === 127) throw new GhError('missing', MISSING_GH);
    if (r.code !== 0) throw new GhError('failed', `gh ${args[0]}: ${(r.stderr || r.stdout).trim() || `exit code ${r.code}`}`);
    return r.stdout;
  }

  /** gh가 github.com에 로그인했는가 — 아니면 gh auth status의 출력을 그대로 */
  async checkAuth(): Promise<void> {
    const r = await this.run(['auth', 'status', '--hostname', 'github.com'], { cwd: this.cwd });
    if (r.code === 127) throw new GhError('missing', MISSING_GH);
    if (r.code !== 0) throw new GhError('auth', `PR mode needs gh signed in to github.com:\n${(r.stderr || r.stdout).trim()}`);
  }

  /** owner/repo·번호는 응답의 url에서 확정한다(포크 원격에서도 base 저장소가 나온다, 스펙 §6-1) */
  async prView(ref: string): Promise<PrView> {
    const raw = JSON.parse(await this.call(['pr', 'view', ref, '--json', 'url,number,title,baseRefName,baseRefOid,headRefOid'])) as Record<string, unknown>;
    const m = PR_URL.exec(String(raw.url ?? ''));
    if (!m) throw new GhError('failed', `PR mode works with pull requests on github.com only (got ${String(raw.url)})`);
    return {
      owner: m[1],
      repo: m[2],
      number: Number(m[3]),
      url: String(raw.url),
      title: String(raw.title ?? ''),
      baseRefName: String(raw.baseRefName),
      baseRefOid: String(raw.baseRefOid),
      headRefOid: String(raw.headRefOid),
    };
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = JSON.parse(await this.call(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables }))) as { data?: T; errors?: Array<{ message?: string }> };
    if (res.errors?.length) throw new GhError('failed', `GitHub GraphQL: ${res.errors.map((e) => e.message ?? '?').join('; ')}`);
    return res.data as T;
  }

  /** paginate는 --paginate --slurp로 받아 페이지 배열들을 하나로 편다 */
  async rest<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, opts: { paginate?: boolean } = {}): Promise<T> {
    const args = ['api', '--method', method, path, ...(body === undefined ? [] : ['--input', '-']), ...(opts.paginate ? ['--paginate', '--slurp'] : [])];
    const out = await this.call(args, body === undefined ? undefined : JSON.stringify(body));
    if (!out.trim()) return undefined as T;
    const data = JSON.parse(out) as unknown;
    return (opts.paginate && Array.isArray(data) ? data.flat() : data) as T;
  }
}

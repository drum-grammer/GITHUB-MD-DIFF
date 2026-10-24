// 명령 해석(스펙 §5-1). 서버는 review만 띄우고, comments·wait·mark·show는 저장 폴더만 본다
import { spawn } from 'node:child_process';
import { closeSync, openSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { ViewKind, ViewPayload } from './api-types';
import { skillTemplate } from './assets';
import { CliError } from './errors';
import { Gh, runGh, type GhRunner, type PrView } from './gh';
import { GitError, readTextAt, repoInfo, type RepoInfo } from './git';
import { formatRounds, isoLocal, roundsJson } from './handoff';
import { cleanPrRefs, fetchPr, parsePrRef } from './pr';
import { PrSession, prLabel } from './pr-session';
import type { Round } from './records';
import { appHandlers } from './routes';
import { IDLE_MS, startServer, type RunningServer } from './server';
import { ReviewSession } from './session';
import { skillCommand } from './skill';
import { StateStore, cleanupStale, stateBase, stateDirFor, type ServerInfo } from './state';
import { VERSION } from './version';
import { oldSideText } from './views';

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  home: string;
  out(text: string): void;
  err(text: string): void;
  /** 끝내라는 신호(Ctrl+C·SIGTERM) — review·wait가 듣는다 */
  signal: AbortSignal;
  /** 주소를 시스템 브라우저로 연다(--open). 시험은 바꿔 끼운다 */
  open(url: string): void;
  /** 지금 도는 .mjs의 절대 경로 — skill 실행 명령을 고를 때 */
  selfPath: string;
  /** PR 모드의 gh 실행기 — 없으면 진짜 gh. 시험은 바꿔 끼운다 */
  gh?: GhRunner;
}

function openInBrowser(url: string): void {
  const child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

export function processIo(): Io {
  const ac = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => ac.abort());
  return {
    cwd: process.cwd(),
    env: process.env,
    home: homedir(),
    out: (t) => void process.stdout.write(`${t}\n`),
    err: (t) => void process.stderr.write(`${t}\n`),
    signal: ac.signal,
    open: openInBrowser,
    selfPath: fileURLToPath(import.meta.url),
  };
}

export const USAGE = `markdown-diff-cat ${VERSION} — review changed Markdown as a rendered diff and hand your comments to an agent

Usage:
  markdown-diff-cat review [--base <ref>] [--since-last] [--open]   start the review page and keep running
  markdown-diff-cat review --reopen [--open]                         print a new one-time link for the running page
  markdown-diff-cat review --pr <number|URL> [--open]                review a GitHub pull request (needs gh signed in)
  markdown-diff-cat comments [--json] [--round N]                    print the rounds not delivered yet
  markdown-diff-cat wait                                             wait for the next "Send to agent", then print it
  markdown-diff-cat mark --rev <id>                                  treat a review render as the last review
  markdown-diff-cat show --rev <id> [--side old|new] <path> [<start>-<end>]   print source lines of either side of a review render
  markdown-diff-cat stop [--clean]                                   stop the server (--clean also removes this worktree's state)
  markdown-diff-cat skill install [--user|--project] [--check]       install or check the agent skill
  markdown-diff-cat --version

Needs macOS or Linux, Node 22.19 or newer, and git. PR mode also needs the GitHub CLI (gh).
In PR mode, comments go to your pending review only when you press "Add to pending review"; you submit the review on GitHub.
State lives in \${XDG_STATE_HOME:-~/.local/state}/markdown-diff-cat (MDC_STATE_DIR overrides it).`;

export { CliError };

type Flags = Map<string, string | true>;
interface Args {
  cmd: string | undefined;
  flags: Flags;
  rest: string[];
}

const VALUE_FLAGS = new Set(['base', 'round', 'rev', 'side', 'command', 'pr']);
const ALLOWED: Record<string, string[]> = {
  review: ['base', 'since-last', 'open', 'reopen', 'pr'],
  comments: ['json', 'round'],
  wait: [],
  mark: ['rev'],
  show: ['rev', 'side'],
  stop: ['clean'],
  skill: ['user', 'project', 'check', 'command'],
};
export const WAIT_POLL_MS = 500;
/** 시작 잠금(server.starting)이 이보다 오래되면 죽은 시작의 흔적으로 보고 넘겨받는다 */
export const CLAIM_MS = 30_000;

export function parseArgs(argv: string[]): Args {
  const flags: Flags = new Map();
  const rest: string[] = [];
  let cmd: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
      if (VALUE_FLAGS.has(name)) {
        const value = eq < 0 ? argv[++i] : a.slice(eq + 1);
        if (value === undefined || value === '' || value.startsWith('--')) throw new CliError(2, `--${name} needs a value`);
        flags.set(name, value);
      } else flags.set(name, true);
    } else if (cmd === undefined) cmd = a;
    else rest.push(a);
  }
  return { cmd, flags, rest };
}

const NOTICE_TEXT: Record<string, (subs: string[]) => string> = {
  reviewNoticeNoBaseline: () => 'No sent round or mark yet — showing changes since the branch point.',
  reviewNoticeBaselineMissing: ([rev]) => `The last review render ${rev} is gone — showing changes since the branch point.`,
  reviewNoticeHeadIsBase: () => 'HEAD is the tip of the default branch, so only uncommitted changes are shown.',
  reviewNoticeUpstream: ([ref]) => `This repository has an upstream remote. For a fork, compare with --base ${ref}.`,
  reviewNoticeSkipped: ([path]) => `Not shown: ${path} resolves outside the repository.`,
  reviewNoticePrCheckout: ([n]) => `This worktree is not on the head of pull request #${n} — run gh pr checkout ${n} before an agent edits the files.`,
};

function stateFor(io: Io, repo: RepoInfo): StateStore {
  const base = stateBase(io.env, io.home);
  const store = new StateStore(base, stateDirFor(base, repo), repo.root);
  store.ensure(VERSION);
  return store;
}

const control = (info: ServerInfo, path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> =>
  fetch(`http://127.0.0.1:${info.port}${path}`, { ...init, headers: { 'x-mdc-control': info.controlSecret, 'content-type': 'application/json', ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(timeoutMs) });

/** 연결은 됐는데 제때 답하지 않음 — 서버가 그리는 중이라 이벤트 루프가 막혔을 수 있다(낡은 것과 다르다) */
const timedOut = (e: unknown): boolean => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
const busyText = (info: ServerInfo, again: string): string =>
  `the review server on port ${info.port} is busy (it may still be drawing a large change) — wait a moment and run markdown-diff-cat ${again}`;

/** server.json의 서버가 살아 있고 이 worktree의 것인가 — 아니면 낡은 파일을 지운다(pid로 죽이지 않는다). 늦게 답하면 바쁜 것으로 보고 파일을 둔다 */
async function liveServer(store: StateStore, repo: RepoInfo, again: string): Promise<(ServerInfo & { mode: string }) | null> {
  const info = store.readServer();
  if (!info) return null;
  try {
    const res = await control(info, '/control/ping', {}, 1500);
    const body = (await res.json()) as { root?: string; mode?: string };
    if (res.ok && body.root === repo.root) return { ...info, mode: body.mode ?? 'worktree' };
  } catch (e) {
    if (timedOut(e)) throw new CliError(1, busyText(info, again));
    // 연결 거부 등 — 낡은 상태 파일
  }
  store.removeServer();
  return null;
}

async function newUrl(info: ServerInfo, path: string, body: unknown): Promise<string> {
  const res = await control(info, path, { method: 'POST', body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  // 400 = 이쪽 입력이 틀림(없는 --base 등) → 종료 코드 2, 나머지는 1
  if (!res.ok || !data.url) throw new CliError(res.status === 400 ? 2 : 1, `the running review server refused the request: ${data.error ?? `HTTP ${res.status}`}`);
  return data.url;
}

/** 같은 worktree에서 review 둘이 거의 동시에 시작해도 서버는 하나 — server.json 확인부터 쓰기까지를 이 파일로 잠근다(스펙 §5-2) */
function claimStart(claim: string): void {
  try {
    closeSync(openSync(claim, 'wx', 0o600));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    if (Date.now() - statSync(claim).mtimeMs < CLAIM_MS) throw new CliError(1, 'another markdown-diff-cat review is starting in this worktree — wait a moment and run markdown-diff-cat review --reopen');
    writeFileSync(claim, '', { mode: 0o600 }); // 오래된 잠금은 죽은 시작의 흔적 — 넘겨받는다
  }
}

const modeText = (mode: string): string => (mode.startsWith('pr:') ? mode.slice(3) : 'the working tree');

/** PR 모드에서 이미 확인한 것 — gh와 PR(받기 전) */
interface PrStart {
  gh: Gh;
  view: PrView;
  ref: string;
}

/** 떠 있는 서버에 요청하거나(0을 돌려준다) 새 서버를 띄워 server.json을 쓴다 — 시작 잠금 안에서 돈다 */
async function startOrReuse(args: Args, io: Io, repo: RepoInfo, store: StateStore, pr: PrStart | null): Promise<number | { server: RunningServer; first: ViewPayload; session: ReviewSession }> {
  const view: ViewKind = args.flags.has('since-last') ? 'since-last' : 'merge-base';
  const base = args.flags.get('base');
  const baseRef = typeof base === 'string' ? base : undefined;
  const mode = pr ? `pr:${prLabel(pr.view)}` : 'worktree';
  const running = await liveServer(store, repo, args.flags.has('reopen') ? 'review --reopen' : 'review');
  // 서버는 worktree마다 하나 — 다른 모드(작업 트리 ↔ PR, 다른 PR)로 바꾸지 않고 멈추게 한다(--reopen은 모드를 묻지 않는다)
  if (running && !args.flags.has('reopen') && running.mode !== mode) {
    throw new CliError(1, `A review server for ${modeText(running.mode)} is already running in this worktree (port ${running.port}) — run markdown-diff-cat stop first.`);
  }
  if (running) {
    const url = args.flags.has('reopen') || pr ? await newUrl(running, '/control/code', {}) : await newUrl(running, '/control/base', { view, base: baseRef });
    io.out(`A review server is already running for this worktree (port ${running.port}).`);
    io.out(`Review page (one-time link, valid 2 minutes): ${url}`);
    if (args.flags.has('open')) io.open(url);
    return 0;
  }
  if (args.flags.has('reopen')) throw new CliError(1, 'no review server is running for this worktree — run markdown-diff-cat review');
  let session: ReviewSession;
  if (pr) {
    const fetched = fetchPr(repo.root, pr.view);
    // 다시 그리기는 PR을 다시 받는다(사이에 올라온 새 커밋)
    const refetch = async () => fetchPr(repo.root, await pr.gh.prView(pr.ref));
    session = new PrSession({ root: repo.root, store, view: 'merge-base', pr: fetched, gh: pr.gh, refetch });
  } else session = new ReviewSession({ root: repo.root, store, baseRef, view });
  const first = session.view();
  for (const n of first.notices) io.out(NOTICE_TEXT[n.key]?.(n.subs ?? []) ?? n.key);
  if (first.files.length === 0) {
    io.out(pr ? `No Markdown changes in ${prLabel(pr.view)}.` : `No Markdown changes between ${first.baseText} and the working tree.`);
    return 0;
  }
  const server = await startServer({ app: appHandlers(session), idleMs: IDLE_MS, pid: process.pid, root: repo.root, mode });
  store.writeServer({ port: server.port, pid: process.pid, startedAt: new Date().toISOString(), controlSecret: server.controlSecret, root: repo.root, version: VERSION });
  return { server, first, session };
}

/** --pr이면 gh 로그인과 PR을 먼저 확인한다(받기는 새 서버를 띄울 때만) */
async function prStart(args: Args, io: Io, repo: RepoInfo): Promise<PrStart | null> {
  const arg = args.flags.get('pr');
  if (arg === undefined) return null;
  const ref = parsePrRef(String(arg));
  const gh = new Gh(io.gh ?? runGh, repo.root);
  await gh.checkAuth();
  return { gh, ref, view: await gh.prView(ref) };
}

async function review(args: Args, io: Io): Promise<number> {
  // 사용법 오류(2)는 저장소·네트워크보다 먼저
  if (args.flags.has('pr')) {
    if (args.flags.has('base') || args.flags.has('since-last')) throw new CliError(2, '--pr does not take --base or --since-last');
    parsePrRef(String(args.flags.get('pr')));
  }
  const repo = repoInfo(io.cwd);
  const pr = await prStart(args, io, repo);
  const store = stateFor(io, repo);
  const kept: string[] = [];
  const removed = cleanupStale(store.base, kept);
  if (removed.length) io.out(`Removed the review state of worktrees that no longer exist: ${removed.join(', ')}`);
  for (const dir of kept) io.out(`Kept the review state of a worktree that no longer exists, because it has unsent comments or rounds not yet read: ${dir}`);
  const claim = store.file('server.starting');
  claimStart(claim);
  let started: Awaited<ReturnType<typeof startOrReuse>>;
  try {
    started = await startOrReuse(args, io, repo, store, pr);
  } finally {
    rmSync(claim, { force: true });
  }
  if (typeof started === 'number') return started;
  const { server, first, session } = started;
  const url = server.newCodeUrl();
  const count = `${first.files.length} Markdown ${first.files.length === 1 ? 'file' : 'files'}`;
  io.out(`Review page (one-time link, valid 2 minutes): ${url}`);
  if (session instanceof PrSession) {
    const p = session.prRef();
    io.out(`Reviewing ${prLabel(p)} ${JSON.stringify(p.title)} — base ${p.mergeBase.slice(0, 7)} → head ${p.headOid.slice(0, 7)} · ${count}`);
    io.out('Comments go to your pending review only when you press "Add to pending review"; you submit the review on GitHub.');
  } else io.out(`Comparing ${first.baseText} → working tree · ${count}`);
  io.out('Keep this command running. After the user presses "Send to agent", read the comments with: markdown-diff-cat wait (or markdown-diff-cat comments)');
  if (!server.ipv6) io.out('IPv6 loopback (::1) is not available; listening on 127.0.0.1 only.');
  if (args.flags.has('open')) io.open(url);
  const onAbort = (): void => void server.close();
  io.signal.addEventListener('abort', onAbort, { once: true });
  await server.closed;
  io.signal.removeEventListener('abort', onAbort);
  store.removeServer();
  return 0;
}

function comments(args: Args, io: Io): number {
  const store = stateFor(io, repoInfo(io.cwd));
  const json = args.flags.has('json');
  const print = (rounds: Round[], again: boolean): void => io.out((json ? roundsJson(rounds) : formatRounds(rounds, { alreadyDelivered: again })).trimEnd());
  return store.withLock('delivered', () => {
    const rounds = store.rounds();
    if (!rounds.length) {
      io.out('No comments yet — the user has not pressed "Send to agent" in the review page.');
      return 0;
    }
    const want = args.flags.get('round');
    if (typeof want === 'string') {
      const r = rounds.find((x) => x.round === Number(want));
      if (!r) throw new CliError(1, `round ${want} does not exist (rounds: 1–${rounds.at(-1)!.round})`);
      print([r], false);
      store.markDelivered([r.round]);
      return 0;
    }
    const done = new Set(store.delivered());
    const pending = rounds.filter((r) => !done.has(r.round));
    if (!pending.length) {
      print([rounds.at(-1)!], true);
      return 0;
    }
    print(pending, false);
    store.markDelivered(pending.map((r) => r.round));
    return 0;
  });
}

/** 넘기지 않은 라운드가 있으면 바로, 없으면 다음 보내기까지 저장 폴더만 지켜본다(서버 없이) */
async function wait(io: Io): Promise<number> {
  const store = stateFor(io, repoInfo(io.cwd));
  for (;;) {
    const delivered = store.withLock('delivered', () => {
      const done = new Set(store.delivered());
      const pending = store.rounds().filter((r) => !done.has(r.round));
      if (!pending.length) return false;
      io.out(formatRounds(pending).trimEnd());
      store.markDelivered(pending.map((r) => r.round));
      return true;
    });
    if (delivered) return 0;
    if (io.signal.aborted) return 130;
    await new Promise((ok) => setTimeout(ok, WAIT_POLL_MS));
  }
}

function mark(args: Args, io: Io): number {
  const rev = args.flags.get('rev');
  if (typeof rev !== 'string') throw new CliError(2, 'usage: markdown-diff-cat mark --rev <id>');
  stateFor(io, repoInfo(io.cwd)).addMark(rev, isoLocal(new Date()));
  io.out(`Marked review render ${rev} as the last review. "markdown-diff-cat review --since-last" now shows the changes after it.`);
  return 0;
}

function show(args: Args, io: Io): number {
  const rev = args.flags.get('rev');
  const sideFlag = args.flags.get('side') ?? 'new';
  const [path, range] = args.rest;
  if (typeof rev !== 'string' || !path || args.rest.length > 2) throw new CliError(2, 'usage: markdown-diff-cat show --rev <id> [--side old|new] <path> [<start>-<end>]');
  if (sideFlag !== 'old' && sideFlag !== 'new') throw new CliError(2, '--side must be old or new');
  const repo = repoInfo(io.cwd);
  const store = stateFor(io, repo);
  const record = store.loadRender(rev);
  if (!record) throw new CliError(1, `review render ${rev} does not exist — run markdown-diff-cat review to draw the files again`);
  let text: string | null;
  if (sideFlag === 'old') {
    const old = oldSideText(repo.root, record, (id) => store.loadRender(id), path);
    if (old === undefined) throw new CliError(1, `the review render that ${rev} was compared with is gone — the old side of ${path} cannot be shown`);
    if (old === null) throw new CliError(1, `${path} has no old side in review render ${rev} (it was added, or renamed from another path)`);
    text = old;
  } else if (Object.hasOwn(record.files, path)) {
    text = record.files[path];
    if (text === null) throw new CliError(1, `${path} was deleted in review render ${rev}`);
  } else {
    // 판에 없는 파일은 그때 기준과 같았다 — 그 판의 기준 커밋 원문
    text = readTextAt(repo.root, record.baseOid, path);
    if (text === null) throw new CliError(1, `${path} is not in review render ${rev} or its base`);
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (range === undefined) {
    io.out(lines.join('\n'));
    return 0;
  }
  const m = /^(\d+)(?:-(\d+))?$/.exec(range);
  const start = m ? Number(m[1]) : Number.NaN;
  const end = m ? Number(m[2] ?? m[1]) : Number.NaN;
  if (!m || start < 1 || end < start) throw new CliError(2, `bad line range "${range}" — use <start>-<end> with 1 ≤ start ≤ end`);
  if (end > lines.length) throw new CliError(1, `lines ${start}-${end} are outside ${path} (${lines.length} lines)`);
  io.out(lines.slice(start - 1, end).join('\n'));
  return 0;
}

async function stop(args: Args, io: Io): Promise<number> {
  const store = stateFor(io, repoInfo(io.cwd));
  const info = store.readServer();
  if (!info) io.out('No review server is running for this worktree.');
  else {
    try {
      const res = await control(info, '/control/stop', { method: 'POST' }, 3000);
      io.out(res.ok ? `Stopped the review server on port ${info.port}.` : `The review server on port ${info.port} refused to stop (HTTP ${res.status}); removed its state file.`);
    } catch (e) {
      if (timedOut(e)) throw new CliError(1, busyText(info, 'stop'));
      io.out(`The review server on port ${info.port} did not answer — it has probably exited. Removed its state file.`);
    }
    store.removeServer();
  }
  if (args.flags.has('clean')) {
    // 이 worktree가 리뷰한 PR — 렌더 판에 남아 있다. 같은 저장소의 다른 worktree가 받은 PR ref는 둔다
    const prs = [...new Set(store.renderIds().flatMap((id) => store.loadRender(id)?.pr?.number ?? []))];
    rmSync(store.dir, { recursive: true, force: true });
    io.out(`Removed this worktree's review state: ${store.dir}`);
    const refs = cleanPrRefs(store.root, prs);
    if (refs.length) io.out(`Removed ${refs.length} fetched pull request ${refs.length === 1 ? 'ref' : 'refs'} (refs/markdown-diff-cat/).`);
  }
  return 0;
}

export async function main(argv: string[], io: Io): Promise<number> {
  try {
    if (argv[0] === '--version' || argv[0] === '-v') {
      io.out(VERSION);
      return 0;
    }
    if (argv.length === 0 || ['--help', '-h', 'help'].includes(argv[0])) {
      io.out(USAGE);
      return 0;
    }
    const args = parseArgs(argv);
    const allowed = args.cmd === undefined ? undefined : ALLOWED[args.cmd];
    if (!allowed) throw new CliError(2, `unknown command "${args.cmd ?? ''}"\n\n${USAGE}`);
    for (const flag of args.flags.keys()) if (!allowed.includes(flag)) throw new CliError(2, `${args.cmd} does not take --${flag}\n\n${USAGE}`);
    switch (args.cmd) {
      case 'review':
        return await review(args, io);
      case 'comments':
        return comments(args, io);
      case 'wait':
        return await wait(io);
      case 'mark':
        return mark(args, io);
      case 'show':
        return show(args, io);
      case 'stop':
        return await stop(args, io);
      default:
        return skillCommand(args.rest, args.flags, io, { template: skillTemplate(), version: VERSION, repoRoot: () => repoInfo(io.cwd).root });
    }
  } catch (e) {
    // 사용법·git 문제는 2, 저장 폴더(StateError)·서버·그 밖은 1
    const code = e instanceof CliError ? e.code : e instanceof GitError ? (e.code === 'git-failed' ? 1 : 2) : 1;
    io.err(`markdown-diff-cat: ${e instanceof Error ? e.message : String(e)}`);
    return code;
  }
}

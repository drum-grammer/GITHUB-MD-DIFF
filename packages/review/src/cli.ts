// 명령 해석(스펙 §5-1). 서버는 review만 띄우고, comments·wait·mark·show는 저장 폴더만 본다
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { VERSION } from './version';

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
}

/** macOS는 open, Linux는 xdg-open — 실패해도 조용히(주소는 이미 출력했다) */
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
  markdown-diff-cat comments [--json] [--round N]                    print the rounds not delivered yet
  markdown-diff-cat wait                                             wait for the next "Send to agent", then print it
  markdown-diff-cat mark --rev <id>                                  treat a review render as the last review
  markdown-diff-cat show --rev <id> <path> [<start>-<end>]           print source lines stored in a review render
  markdown-diff-cat stop [--clean]                                   stop the server (--clean also removes this worktree's state)
  markdown-diff-cat skill install [--user|--project] [--check]       install or check the agent skill
  markdown-diff-cat --version

Needs macOS or Linux, Node 22 or newer, and git.
State lives in \${XDG_STATE_HOME:-~/.local/state}/markdown-diff-cat (MDC_STATE_DIR overrides it).`;

export async function main(argv: string[], io: Io): Promise<number> {
  const [cmd] = argv;
  if (cmd === '--version' || cmd === '-v') {
    io.out(VERSION);
    return 0;
  }
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    io.out(USAGE);
    return 0;
  }
  io.err(`markdown-diff-cat: unknown command "${cmd}"\n\n${USAGE}`);
  return 2;
}

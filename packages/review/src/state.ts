// 저장 폴더 — .git 밖 사용자 상태 폴더(스펙 §5-4). 스냅숏을 ref로 두면 bundle --all·push --mirror에 실려 나가고,
// 연결 worktree의 refs는 다른 worktree의 gc에 지워질 수 있고, worktree 안에 두면 에이전트의 파일 목록에 섞이기 때문이다
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type StateErrorCode = 'unwritable' | 'not-owner' | 'busy' | 'no-render';

export class StateError extends Error {
  constructor(
    readonly code: StateErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ServerInfo {
  port: number;
  pid: number;
  startedAt: string;
  /** 제어 API(/control/*) 비밀 — CLI만 안다 */
  controlSecret: string;
  root: string;
  version: string;
}

export function stateBase(env: NodeJS.ProcessEnv, home: string): string {
  if (env.MDC_STATE_DIR) return env.MDC_STATE_DIR;
  return join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'markdown-diff-cat');
}

export const idOf = (realPath: string): string => createHash('sha256').update(realPath).digest('hex').slice(0, 16);

/** <바탕>/<저장소 id>/<worktree id> — 저장소 id는 공통 git 폴더, worktree id는 최상위 realpath의 해시 */
export function stateDirFor(base: string, repo: { root: string; commonDir: string }): string {
  return join(base, idOf(repo.commonDir), idOf(repo.root));
}

const sleepSync = (ms: number): void => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export class StateStore {
  constructor(
    readonly base: string,
    readonly dir: string,
    readonly root: string,
  ) {}

  /** 폴더를 0700으로 만들고 실제로 한 번 써 본다 — 샌드박스에서 막히면 시작할 때 이유와 함께 멈춘다(보내기 때 조용히 실패하지 않게) */
  ensure(version: string): void {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      for (const d of [dirname(this.dir), this.dir]) chmodSync(d, 0o700);
      this.writeJson('worktree.json', { root: this.root, version, touchedAt: new Date().toISOString() });
    } catch (e) {
      throw new StateError('unwritable', `cannot write the state folder ${this.dir}: ${(e as Error).message} — set MDC_STATE_DIR to a folder you can write`);
    }
  }

  file(name: string): string {
    return join(this.dir, name);
  }

  readJson<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(this.file(name), 'utf8')) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw e;
    }
  }

  /** 같은 폴더의 임시 파일(0600)에 쓰고 rename — 읽는 쪽이 반쯤 쓴 파일을 보지 않게 */
  writeText(name: string, text: string): void {
    const path = this.file(name);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = join(dirname(path), `.${randomBytes(6).toString('hex')}.tmp`);
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, path);
  }

  writeJson(name: string, value: unknown): void {
    this.writeText(name, `${JSON.stringify(value, null, 2)}\n`);
  }

  remove(name: string): void {
    rmSync(this.file(name), { force: true });
  }

  /** 프로세스 사이 잠금(<이름>.lock을 wx로 만든다). 같은 이름을 겹쳐 잡지 않는다. 오래된 잠금(죽은 프로세스)은 걷는다 */
  withLock<T>(name: string, fn: () => T, opts: { timeoutMs?: number; staleMs?: number } = {}): T {
    const { timeoutMs = 5000, staleMs = 10_000 } = opts;
    const lock = this.file(`${name}.lock`);
    const until = Date.now() + timeoutMs;
    for (;;) {
      try {
        closeSync(openSync(lock, 'wx', 0o600));
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        try {
          if (Date.now() - statSync(lock).mtimeMs > staleMs) {
            unlinkSync(lock);
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() > until) throw new StateError('busy', `the state folder is busy (${lock}) — try again`);
        sleepSync(50);
      }
    }
    try {
      return fn();
    } finally {
      rmSync(lock, { force: true });
    }
  }

  /** server.json — 다른 사용자가 만든 것이면 쓰지 않는다(소유 uid 확인) */
  readServer(uid: number = process.getuid?.() ?? -1): ServerInfo | null {
    const path = this.file('server.json');
    if (!existsSync(path)) return null;
    if (statSync(path).uid !== uid) throw new StateError('not-owner', `${path} is not owned by you — refusing to use it`);
    return this.readJson<ServerInfo | null>('server.json', null);
  }

  writeServer(info: ServerInfo): void {
    this.writeJson('server.json', info);
  }

  removeServer(): void {
    this.remove('server.json');
  }
}

/** 시작할 때 — worktree가 더는 없는 저장 폴더를 지운다. 지운 worktree 경로를 돌려준다(출력에 적는다) */
export function cleanupStale(base: string): string[] {
  const removed: string[] = [];
  let repos: string[];
  try {
    repos = readdirSync(base);
  } catch {
    return removed;
  }
  for (const repo of repos) {
    const repoDir = join(base, repo);
    let worktrees: string[];
    try {
      worktrees = readdirSync(repoDir);
    } catch {
      continue;
    }
    for (const wt of worktrees) {
      const dir = join(repoDir, wt);
      let root: string | undefined;
      try {
        root = (JSON.parse(readFileSync(join(dir, 'worktree.json'), 'utf8')) as { root?: string }).root;
      } catch {
        continue; // 우리 폴더가 아니거나 아직 쓰는 중
      }
      if (root && !existsSync(root)) {
        rmSync(dir, { recursive: true, force: true });
        removed.push(root);
      }
    }
    try {
      if (readdirSync(repoDir).length === 0) rmSync(repoDir, { recursive: true, force: true });
    } catch {
      // 다른 프로세스가 지웠다
    }
  }
  return removed;
}

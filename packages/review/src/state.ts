// 저장 폴더 — .git 밖 사용자 상태 폴더(스펙 §5-4). 스냅숏을 ref로 두면 bundle --all·push --mirror에 실려 나가고,
// 연결 worktree의 refs는 다른 worktree의 gc에 지워질 수 있고, worktree 안에 두면 에이전트의 파일 목록에 섞이기 때문이다
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Draft, Mark, RenderRecord, Round } from './records';

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
const RENDER_ID = /^r[0-9a-z]{5}$/;
const ROUND_FILE = /^\d{4,}-[0-9T]+\.json$/;

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

  // ── 렌더 판 ──

  newRenderId(): string {
    for (;;) {
      const id = `r${randomBytes(4).readUInt32BE(0).toString(36).padStart(5, '0').slice(-5)}`;
      if (!existsSync(this.file(`renders/${id}.json`))) return id;
    }
  }

  saveRender(r: RenderRecord): void {
    this.writeJson(`renders/${r.id}.json`, r);
  }

  /** 모양이 맞는 id만 읽는다 — 경로를 흉내 낸 값('../server')으로 다른 파일을 읽지 않게 */
  loadRender(id: string): RenderRecord | null {
    return RENDER_ID.test(id) ? this.readJson<RenderRecord | null>(`renders/${id}.json`, null) : null;
  }

  renderIds(): string[] {
    try {
      return readdirSync(this.file('renders'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .filter((id) => RENDER_ID.test(id));
    } catch {
      return [];
    }
  }

  /**
   * 라운드(와 그 코멘트)·마지막 mark·초안·alsoPinned(지금 화면)이 가리키는 판은 지우지 않고, 아무도 가리키지 않는 판만 최근 keep개로 자른다.
   * 순서는 파일 mtime(ms) — 같은 초에 여러 번 다시 그려도 순서가 선다
   */
  pruneRenders(keep = 20, alsoPinned: string[] = []): string[] {
    const pinned = new Set<string>(alsoPinned);
    for (const r of this.rounds()) {
      pinned.add(r.rev);
      for (const c of r.comments) pinned.add(c.rev);
    }
    for (const d of this.drafts()) pinned.add(d.rev);
    const last = this.marks().at(-1);
    if (last) pinned.add(last.rev);
    const loose = this.renderIds()
      .filter((id) => !pinned.has(id))
      .map((id) => ({ id, at: statSync(this.file(`renders/${id}.json`)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    const gone = loose.slice(keep).map((x) => x.id);
    for (const id of gone) this.remove(`renders/${id}.json`);
    return gone;
  }

  // ── 초안 ──

  drafts(): Draft[] {
    return this.readJson<Draft[]>('drafts.json', []);
  }

  saveDrafts(list: Draft[]): void {
    this.writeJson('drafts.json', list);
  }

  // ── 라운드 ──

  rounds(): Round[] {
    let names: string[];
    try {
      names = readdirSync(this.file('rounds'));
    } catch {
      return [];
    }
    return names
      .filter((f) => ROUND_FILE.test(f))
      .map((f) => this.readJson<Round | null>(`rounds/${f}`, null))
      .filter((r): r is Round => r !== null)
      .sort((a, b) => a.round - b.round);
  }

  nextRoundNumber(): number {
    return (this.rounds().at(-1)?.round ?? 0) + 1;
  }

  /** rounds/0002-20261016T140300.json(정본)과 .md(넘기기 형식). 정본 경로를 돌려준다 */
  saveRound(round: Round, markdown: string): string {
    const stamp = round.createdAt.slice(0, 19).replace(/[-:]/g, '');
    const name = `rounds/${String(round.round).padStart(4, '0')}-${stamp}`;
    this.writeJson(`${name}.json`, round);
    this.writeText(`${name}.md`, markdown);
    return this.file(`${name}.json`);
  }

  // ── 넘김 ──

  delivered(): number[] {
    return this.readJson<{ rounds: number[] }>('delivered.json', { rounds: [] }).rounds;
  }

  markDelivered(nums: number[]): void {
    this.writeJson('delivered.json', { rounds: [...new Set([...this.delivered(), ...nums])].sort((a, b) => a - b) });
  }

  // ── mark(Codex 주석을 처리할 때 그 판을 "지난 리뷰"로) ──

  marks(): Mark[] {
    return this.readJson<Mark[]>('marks.json', []);
  }

  addMark(rev: string, at: string): Mark {
    if (!this.loadRender(rev)) throw new StateError('no-render', `review render ${rev} does not exist — run markdown-diff-cat review to draw the files again`);
    const mark: Mark = { rev, at };
    this.writeJson('marks.json', [...this.marks(), mark]);
    return mark;
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

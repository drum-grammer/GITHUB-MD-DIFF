// E2E 도우미 — 임시 저장소, 배포 파일 그대로의 CLI, 페이지 안에서 세션 헤더를 싣는 API 호출
import { expect, type Locator, type Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const CLI = resolve('dist/markdown-diff-cat.mjs');
const URL_RE = /http:\/\/localhost:\d+\/\?code=[0-9a-f]{32}/;

export interface Repo {
  dir: string;
  state: string;
  write(path: string, text: string): void;
  move(from: string, to: string): void;
  git(...args: string[]): string;
  cleanup(): void;
}

export function makeRepo(files: Record<string, string>, opts: { branch?: string } = {}): Repo {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'mdc-e2e-')));
  const state = realpathSync(mkdtempSync(join(tmpdir(), 'mdc-e2e-state-')));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'e2e@example.com');
  git('config', 'user.name', 'E2E');
  git('config', 'commit.gpgsign', 'false');
  for (const [p, t] of Object.entries(files)) write(p, t);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  if (opts.branch) git('checkout', '-q', '-b', opts.branch);
  return {
    dir,
    state,
    write,
    move(from, to) {
      mkdirSync(dirname(join(dir, to)), { recursive: true });
      renameSync(join(dir, from), join(dir, to));
    },
    git,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      rmSync(state, { recursive: true, force: true });
    },
  };
}

export function cli(repo: Repo, ...args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd: repo.dir, env: { ...process.env, MDC_STATE_DIR: repo.state }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const x = e as { status: number; stdout: string; stderr: string };
    return { code: x.status, stdout: x.stdout, stderr: x.stderr };
  }
}

export interface Review {
  url: string;
  output(): string;
  stop(): Promise<void>;
}

/** review를 백그라운드로 띄우고 1회용 주소가 나오면 돌려준다(에이전트가 run_in_background로 띄우는 것과 같다) */
export function startReview(repo: Repo, ...args: string[]): Promise<Review> {
  const child = spawn(process.execPath, [CLI, 'review', ...args], { cwd: repo.dir, env: { ...process.env, MDC_STATE_DIR: repo.state }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  return new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`no review URL in 20s:\n${out}`)), 20_000);
    const exited = new Promise<void>((done) => child.once('exit', () => done()));
    const take = (d: Buffer): void => {
      out += d.toString();
      const m = URL_RE.exec(out);
      if (!m) return;
      clearTimeout(timer);
      ok({
        url: m[0],
        output: () => out,
        stop: async () => {
          cli(repo, 'stop');
          await exited;
        },
      });
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.once('exit', (code) => {
      clearTimeout(timer);
      fail(new Error(`review exited (${code}) before printing a URL:\n${out}`));
    });
  });
}

/** 페이지 안에서 — 그 탭의 세션 비밀을 싣고 같은 출처로(브라우저가 Origin·Sec-Fetch-Site를 붙인다) */
export function api<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const secret = sessionStorage.getItem('mdc-session') ?? '';
      const res = await fetch(path, { method, headers: { 'X-MDC-Session': secret, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return res.json();
    },
    { method, path, body },
  ) as Promise<T>;
}

/** 블록에 마우스를 올려 그 파일의 "+"가 나올 때까지(첫 호버에 매핑을 만든다) — 확장 e2e/comments.spec.ts:43과 같은 방법. "+"는 파일마다 하나다 */
export async function hoverUntilPlus(file: Locator, block: Locator): Promise<void> {
  const plus = file.locator('[data-mdf="add-comment"]');
  await expect(async () => {
    await block.hover({ position: { x: 10, y: 5 } });
    await block.hover({ position: { x: 20, y: 6 } });
    await expect(plus).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
}

/** 저장 폴더의 렌더 판 수(저장소·worktree id 폴더 아래 renders/) */
export function renderCount(repo: Repo): number {
  let n = 0;
  for (const r of readdirSync(repo.state)) for (const w of readdirSync(join(repo.state, r))) {
    try {
      n += readdirSync(join(repo.state, r, w, 'renders')).length;
    } catch {
      // 렌더 판 폴더가 아직 없다
    }
  }
  return n;
}

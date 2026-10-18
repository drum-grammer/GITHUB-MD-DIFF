// 시험마다 임시 git 저장소를 만든다 — macOS의 /var → /private/var 때문에 경로는 realpath로 돌려준다
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TempRepo {
  dir: string;
  git(...args: string[]): string;
  write(path: string, text: string | Buffer): void;
  remove(path: string): void;
  commit(message?: string): string;
  cleanup(): void;
}

export function tempDir(prefix = 'mdc-'): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

function wrap(dir: string): TempRepo {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return {
    dir,
    git,
    write(path, text) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    },
    remove(path) {
      unlinkSync(join(dir, path));
    },
    commit(message = 'commit') {
      git('add', '-A');
      git('commit', '-q', '--allow-empty', '-m', message);
      return git('rev-parse', 'HEAD');
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function identity(r: TempRepo): TempRepo {
  r.git('config', 'user.email', 'test@example.com');
  r.git('config', 'user.name', 'Test');
  r.git('config', 'commit.gpgsign', 'false');
  return r;
}

export function tempRepo(opts: { bare?: boolean } = {}): TempRepo {
  const dir = tempDir('mdc-repo-');
  execFileSync('git', ['init', '-q', '-b', 'main', ...(opts.bare ? ['--bare'] : []), dir], { stdio: 'ignore' });
  return opts.bare ? wrap(dir) : identity(wrap(dir));
}

/** origin을 원격으로 둔 clone — extra에 --depth 1 같은 옵션(얕은 clone은 file:// 주소여야 한다) */
export function cloneOf(origin: TempRepo, extra: string[] = []): TempRepo {
  const dir = tempDir('mdc-clone-');
  const url = extra.some((a) => a.startsWith('--depth')) ? `file://${origin.dir}` : origin.dir;
  execFileSync('git', ['clone', '-q', ...extra, url, dir], { stdio: 'ignore' });
  return identity(wrap(dir));
}

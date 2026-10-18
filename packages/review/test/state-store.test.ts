import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StateError, StateStore, cleanupStale, idOf, stateBase, stateDirFor, type ServerInfo } from '../src/state';
import { tempDir } from './helpers/git-repo';

const mode = (p: string): number => statSync(p).mode & 0o777;
const store = (base = tempDir('mdc-state-'), root = tempDir('mdc-wt-')): StateStore => new StateStore(base, stateDirFor(base, { root, commonDir: join(root, '.git') }), root);
const info: ServerInfo = { port: 4321, pid: 99, startedAt: '2026-10-16T05:00:00.000Z', controlSecret: 'c'.repeat(64), root: '/r', version: '1.5.1' };

describe('stateBase · stateDirFor', () => {
  it('MDC_STATE_DIR > XDG_STATE_HOME > ~/.local/state', () => {
    expect(stateBase({ MDC_STATE_DIR: '/s', XDG_STATE_HOME: '/x' }, '/h')).toBe('/s');
    expect(stateBase({ XDG_STATE_HOME: '/x' }, '/h')).toBe('/x/markdown-diff-cat');
    expect(stateBase({}, '/h')).toBe('/h/.local/state/markdown-diff-cat');
  });
  it('저장소 id는 공통 git 폴더, worktree id는 최상위의 해시(16자) — worktree 둘은 저장소 폴더를 같이 쓴다', () => {
    const a = stateDirFor('/b', { root: '/w/a', commonDir: '/w/a/.git' });
    const b = stateDirFor('/b', { root: '/w/b', commonDir: '/w/a/.git' });
    expect(a).toBe(join('/b', idOf('/w/a/.git'), idOf('/w/a')));
    expect(idOf('/w/a')).toMatch(/^[0-9a-f]{16}$/);
    expect(a.split('/').at(-2)).toBe(b.split('/').at(-2));
    expect(a).not.toBe(b);
  });
});

describe('StateStore', () => {
  it('ensure는 폴더를 0700으로 만들고 worktree.json(0600)을 써 본다', () => {
    const s = store();
    s.ensure('1.5.1');
    expect(mode(s.dir)).toBe(0o700);
    expect(mode(join(s.dir, '..'))).toBe(0o700);
    expect(mode(s.file('worktree.json'))).toBe(0o600);
    expect(s.readJson<{ root: string }>('worktree.json', { root: '' }).root).toBe(s.root);
  });
  it('쓸 수 없으면 이유와 MDC_STATE_DIR 안내를 담아 unwritable로 멈춘다', () => {
    const base = tempDir('mdc-ro-');
    chmodSync(base, 0o500);
    const s = store(base);
    expect(() => s.ensure('1.5.1')).toThrow(StateError);
    expect(() => s.ensure('1.5.1')).toThrow('MDC_STATE_DIR');
    chmodSync(base, 0o700);
  });
  it('writeJson은 하위 폴더를 만들고 임시 파일 없이 0600으로 바꿔 넣는다', () => {
    const s = store();
    s.ensure('1.5.1');
    s.writeJson('renders/r00001.json', { a: 1 });
    expect(s.readJson('renders/r00001.json', null)).toEqual({ a: 1 });
    expect(mode(s.file('renders/r00001.json'))).toBe(0o600);
    expect(mode(s.file('renders'))).toBe(0o700);
    expect(readdirSync(s.file('renders'))).toEqual(['r00001.json']);
  });
  it('readJson은 없으면 기본값', () => {
    expect(store().readJson('none.json', 7)).toBe(7);
  });
  it('server.json을 쓰고 읽고 지운다 — 소유자가 다르면 not-owner', () => {
    const s = store();
    s.ensure('1.5.1');
    expect(s.readServer()).toBeNull();
    s.writeServer(info);
    expect(s.readServer()).toEqual(info);
    expect(mode(s.file('server.json'))).toBe(0o600);
    expect(() => s.readServer((process.getuid?.() ?? 0) + 1)).toThrow('not owned by you');
    s.removeServer();
    expect(s.readServer()).toBeNull();
  });
  it('withLock — 잠금이 잡혀 있으면 기다리다 busy, 오래된 잠금은 걷고 들어간다', () => {
    const s = store();
    s.ensure('1.5.1');
    writeFileSync(s.file('rounds.lock'), '');
    expect(() => s.withLock('rounds', () => 1, { timeoutMs: 120 })).toThrow('busy');
    const old = new Date(Date.now() - 60_000);
    utimesSync(s.file('rounds.lock'), old, old);
    expect(s.withLock('rounds', () => 2)).toBe(2);
    expect(existsSync(s.file('rounds.lock'))).toBe(false);
  });
});

describe('cleanupStale', () => {
  it('worktree가 더는 없는 저장 폴더만 지우고 그 경로를 돌려준다', () => {
    const base = tempDir('mdc-state-');
    const alive = store(base);
    alive.ensure('1.5.1');
    const ghostRoot = join(tempDir('mdc-gone-'), 'deleted-worktree');
    const ghost = new StateStore(base, stateDirFor(base, { root: ghostRoot, commonDir: '/somewhere/.git' }), ghostRoot);
    mkdirSync(ghost.dir, { recursive: true });
    ghost.writeJson('worktree.json', { root: ghostRoot, version: '1.5.1' });
    expect(cleanupStale(base)).toEqual([ghostRoot]);
    expect(existsSync(ghost.dir)).toBe(false);
    expect(existsSync(join(ghost.dir, '..'))).toBe(false);
    expect(existsSync(alive.dir)).toBe(true);
  });
  it('저장 폴더가 아직 없으면 아무것도 하지 않는다', () => {
    expect(cleanupStale(join(tempDir(), 'none'))).toEqual([]);
  });
});

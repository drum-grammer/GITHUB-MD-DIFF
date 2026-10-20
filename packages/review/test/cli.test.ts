import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, parseArgs, type Io } from '../src/cli';
import { StateStore, stateBase, stateDirFor } from '../src/state';
import { cloneOf, tempDir, tempRepo, type TempRepo } from './helpers/git-repo';
import { exchange, pageHeaders, request } from './helpers/http';

const repos: TempRepo[] = [];
afterEach(() => {
  for (const r of repos.splice(0)) r.cleanup();
});

type TestIo = Io & { lines: string[]; errs: string[]; opened: string[]; abort(): void; waitFor(re: RegExp): Promise<string> };
function testIo(cwd: string, state: string): TestIo {
  const lines: string[] = [];
  const errs: string[] = [];
  const opened: string[] = [];
  const ac = new AbortController();
  return {
    cwd,
    env: { ...process.env, MDC_STATE_DIR: state },
    home: state,
    out: (t) => void lines.push(t),
    err: (t) => void errs.push(t),
    signal: ac.signal,
    open: (u) => void opened.push(u),
    selfPath: '/opt/mdc/markdown-diff-cat.mjs',
    lines,
    errs,
    opened,
    abort: () => ac.abort(),
    async waitFor(re) {
      for (let i = 0; i < 300; i++) {
        const hit = lines.join('\n').match(re);
        if (hit) return hit[0];
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`not printed: ${re}\n${lines.join('\n')}\n${errs.join('\n')}`);
    },
  };
}
function repoWith(files: Record<string, string>, edits: Record<string, string>): TempRepo {
  const r = tempRepo();
  repos.push(r);
  for (const [p, t] of Object.entries(files)) r.write(p, t);
  r.commit();
  for (const [p, t] of Object.entries(edits)) r.write(p, t);
  return r;
}
const URL_RE = /http:\/\/localhost:(\d+)\/\?code=[0-9a-f]{32}/;
const storeOf = (r: TempRepo, state: string): StateStore => {
  const base = stateBase({ MDC_STATE_DIR: state }, state);
  return new StateStore(base, stateDirFor(base, { root: r.dir, commonDir: join(r.dir, '.git') }), r.dir);
};
/** 떠 있는 서버의 새 1회용 주소(review --reopen) — 코드는 한 번만 쓸 수 있다 */
async function freshUrl(dir: string, state: string): Promise<string> {
  const io = testIo(dir, state);
  expect(await main(['review', '--reopen'], io)).toBe(0);
  return io.waitFor(URL_RE);
}
/** 떠 있는 서버에 페이지처럼 코멘트 하나를 달고 보낸다(url의 코드를 쓴다) */
async function sendOne(url: string, path: string, line: number, body: string): Promise<void> {
  const port = Number(URL_RE.exec(url)![1]);
  const secret = await exchange(port, url);
  const call = async (method: string, p: string, b?: unknown) => JSON.parse((await request(port, { method, path: p, body: b, headers: pageHeaders(port, secret) })).text);
  const view = await call('GET', '/api/view');
  await call('POST', '/api/drafts', { rev: view.rev, path, side: 'right', start: line, end: line, body });
  await call('POST', '/api/send', { rev: view.rev });
}

describe('parseArgs', () => {
  it('--이름 값·--이름=값·불리언·나머지', () => {
    const a = parseArgs(['show', '--rev', 'r00001', 'docs/a b.md', '3-5']);
    expect(a.cmd).toBe('show');
    expect(a.flags.get('rev')).toBe('r00001');
    expect(a.rest).toEqual(['docs/a b.md', '3-5']);
    expect(parseArgs(['review', '--base=origin/dev', '--since-last']).flags).toEqual(new Map<string, string | true>([['base', 'origin/dev'], ['since-last', true]]));
  });
});

describe('간단한 명령', () => {
  it('--version·--help·모르는 명령(2)·받지 않는 옵션(2)', async () => {
    const io = testIo(tempDir(), tempDir());
    expect(await main(['--version'], io)).toBe(0);
    expect(io.lines[0]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(await main(['--help'], io)).toBe(0);
    expect(await main(['frobnicate'], io)).toBe(2);
    expect(await main(['comments', '--base', 'x'], io)).toBe(2);
    expect(io.errs.join('\n')).toContain('comments does not take --base');
  });
  it('git 저장소가 아니면 2, --pr은 아직 없음(2)', async () => {
    const io = testIo(tempDir(), tempDir());
    expect(await main(['review'], io)).toBe(2);
    expect(io.errs[0]).toBe('markdown-diff-cat: not a git repository — run it inside a working tree');
    expect(await main(['review', '--pr', '12'], io)).toBe(2);
    expect(io.errs[1]).toContain('PR mode (--pr) is not available');
  });
  it('저장 폴더를 못 쓰면 이유와 함께 1', async () => {
    const r = repoWith({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    const file = join(tempDir(), 'not-a-folder');
    writeFileSync(file, 'x');
    const io = testIo(r.dir, file);
    expect(await main(['comments'], io)).toBe(1);
    expect(io.errs[0]).toContain('cannot write the state folder');
  });
  it('md 변경이 없으면 서버 없이 0', async () => {
    const r = repoWith({ 'a.md': 'a\n' }, {});
    const state = tempDir();
    const io = testIo(r.dir, state);
    expect(await main(['review'], io)).toBe(0);
    expect(io.lines.join('\n')).toMatch(/^No Markdown changes between [0-9a-f]{7} \(merge-base main\) and the working tree\.$/m);
    expect(existsSync(storeOf(r, state).file('server.json'))).toBe(false);
  });
  it('기본 브랜치를 못 정하면 --base 안내(2), 얕은 clone은 git fetch --deepen 안내(2)', async () => {
    const r = repoWith({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    r.git('remote', 'add', 'origin', 'https://example.invalid/x.git');
    const io = testIo(r.dir, tempDir());
    expect(await main(['review'], io)).toBe(2);
    expect(io.errs[0]).toContain('pass --base <ref>');
    const origin = repoWith({ 'a.md': 'A\n' }, {});
    origin.git('checkout', '-q', '-b', 'feature');
    origin.write('f.md', 'F\n');
    origin.commit('F');
    origin.git('checkout', '-q', 'main');
    origin.write('b.md', 'B\n');
    origin.commit('B');
    const shallow = cloneOf(origin, ['--depth', '1', '--branch', 'feature']);
    repos.push(shallow);
    shallow.git('fetch', '-q', '--depth', '1', 'origin', 'main:refs/remotes/origin/main');
    const io2 = testIo(shallow.dir, tempDir());
    expect(await main(['review', '--base', 'origin/main'], io2)).toBe(2);
    expect(io2.errs[0]).toContain('git fetch --deepen');
  });
});

describe('review → 보내기 → comments·wait → --since-last → stop', () => {
  it('한 바퀴', async () => {
    const r = repoWith({ 'docs/guide.md': '# Guide\n\nInstall with one command.\n' }, { 'docs/guide.md': '# Guide\n\nInstall with a single command.\n' });
    const state = tempDir();
    const io = testIo(r.dir, state);
    const running = main(['review', '--open'], io);
    const url = await io.waitFor(URL_RE);
    expect(io.opened).toEqual([url]);
    expect(io.lines.join('\n')).toContain('Comparing ');
    const store = storeOf(r, state);
    expect(statSync(store.file('server.json')).mode & 0o777).toBe(0o600);

    const none = testIo(r.dir, state);
    expect(await main(['comments'], none)).toBe(0);
    expect(none.lines[0]).toContain('No comments yet');

    await sendOne(url, 'docs/guide.md', 3, 'Shorter.');
    const got = testIo(r.dir, state);
    expect(await main(['comments'], got)).toBe(0);
    expect(got.lines.join('\n')).toContain('<!-- markdown-diff-cat round 1 · ');
    expect(got.lines.join('\n')).toContain('### 1 · L3 (new) · heading ["Guide"] · author: you');
    const again = testIo(r.dir, state);
    await main(['comments'], again);
    expect(again.lines.join('\n')).toMatch(/round 1 .* · already delivered -->/);
    const json = testIo(r.dir, state);
    await main(['comments', '--json', '--round', '1'], json);
    expect(JSON.parse(json.lines.join('\n')).rounds[0].comments[0].body).toBe('Shorter.');
    expect(await main(['comments', '--round', '9'], testIo(r.dir, state))).toBe(1);

    // 기다리기 전에 보낸 라운드는 wait가 바로 낸다
    await sendOne(await freshUrl(r.dir, state), 'docs/guide.md', 1, 'Rename the title.');
    const waited = testIo(r.dir, state);
    expect(await main(['wait'], waited)).toBe(0);
    expect(waited.lines.join('\n')).toContain('<!-- markdown-diff-cat round 2 · ');

    // 두 번째 review는 떠 있는 서버에 기준 바꾸기를 요청하고 새 주소를 낸다
    r.write('docs/guide.md', '# Guide\n\nInstall with a single short command.\n');
    const second = testIo(r.dir, state);
    expect(await main(['review', '--since-last'], second)).toBe(0);
    expect(second.lines.join('\n')).toContain('already running');
    const url2 = await second.waitFor(URL_RE);
    expect(url2).not.toBe(url);
    const reopen = testIo(r.dir, state);
    expect(await main(['review', '--reopen'], reopen)).toBe(0);
    expect(await reopen.waitFor(URL_RE)).not.toBe(url2);

    expect(await main(['stop'], testIo(r.dir, state))).toBe(0);
    expect(await running).toBe(0);
    expect(existsSync(store.file('server.json'))).toBe(false);
    expect(await main(['review', '--reopen'], testIo(r.dir, state))).toBe(1);
  });
  it('wait는 다음 보내기까지 기다렸다가 낸다(Ctrl+C면 130)', async () => {
    const r = repoWith({ 'a.md': '# A\n\none\n' }, { 'a.md': '# A\n\ntwo\n' });
    const state = tempDir();
    const io = testIo(r.dir, state);
    const running = main(['review'], io);
    const url = await io.waitFor(URL_RE);
    const w = testIo(r.dir, state);
    const waiting = main(['wait'], w);
    await new Promise((res) => setTimeout(res, 300));
    expect(w.lines).toEqual([]);
    await sendOne(url, 'a.md', 3, 'later');
    expect(await waiting).toBe(0);
    expect(w.lines.join('\n')).toContain('round 1');
    const idle = testIo(r.dir, state);
    const idleWait = main(['wait'], idle);
    idle.abort();
    expect(await idleWait).toBe(130);
    io.abort();
    expect(await running).toBe(0);
  });
});

describe('mark · show · stop --clean', () => {
  it('없는 판은 1, 있는 판은 marks.json — show는 판의 원문과 줄 범위', async () => {
    const r = repoWith({ 'a.md': 'one\r\ntwo\r\nthree\r\n' }, { 'a.md': 'one\r\nTWO\r\nthree\r\n' });
    const state = tempDir();
    const io = testIo(r.dir, state);
    const running = main(['review'], io);
    await io.waitFor(URL_RE);
    const store = storeOf(r, state);
    const rev = store.renderIds()[0];
    expect(await main(['mark', '--rev', 'rnope1'], testIo(r.dir, state))).toBe(1);
    expect(await main(['mark', '--rev', rev], testIo(r.dir, state))).toBe(0);
    expect(store.marks().map((m) => m.rev)).toEqual([rev]);
    const show = testIo(r.dir, state);
    expect(await main(['show', '--rev', rev, 'a.md', '2-3'], show)).toBe(0);
    expect(show.lines).toEqual(['TWO\nthree']);
    expect(await main(['show', '--rev', rev, 'a.md', '3-2'], testIo(r.dir, state))).toBe(2);
    expect(await main(['show', '--rev', rev, 'a.md', '2-9'], testIo(r.dir, state))).toBe(1);
    expect(await main(['show', '--rev', rev, 'none.md'], testIo(r.dir, state))).toBe(1);
    expect(await main(['stop', '--clean'], testIo(r.dir, state))).toBe(0);
    expect(await running).toBe(0);
    expect(existsSync(store.dir)).toBe(false);
  });
});

describe('Review Focus', () => {
  it('강제 종료로 남은 낡은 server.json — 믿지 않고 새 서버를 띄우고, stop은 그 pid를 죽이지 않는다', async () => {
    const r = repoWith({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    const state = tempDir();
    const store = storeOf(r, state);
    store.ensure('test');
    const stale = { port: 1, pid: process.pid, startedAt: '2026-10-16T00:00:00Z', controlSecret: 'x'.repeat(64), root: r.dir, version: 'old' };
    store.writeServer(stale);
    const stop = testIo(r.dir, state);
    expect(await main(['stop'], stop)).toBe(0);
    expect(stop.lines.join('\n')).toContain('did not answer');
    store.writeServer(stale);
    const io = testIo(r.dir, state);
    const running = main(['review'], io);
    await io.waitFor(URL_RE);
    expect(JSON.parse(readFileSync(store.file('server.json'), 'utf8')).port).not.toBe(1);
    io.abort();
    expect(await running).toBe(0);
  });
  it('같은 저장소의 worktree 둘 — 저장 폴더·서버가 따로, 한쪽 stop이 다른 쪽을 끄지 않는다', async () => {
    const r = repoWith({ 'a.md': 'a\n' }, {});
    r.git('checkout', '-q', '-b', 'one');
    r.write('a.md', 'one\n');
    const wt = `${r.dir}-two`;
    r.git('worktree', 'add', '-q', '-b', 'two', wt, 'main');
    repos.push({ ...r, dir: wt, cleanup: () => rmSync(wt, { recursive: true, force: true }) });
    writeFileSync(join(wt, 'a.md'), 'two\n');
    const state = tempDir();
    const ioA = testIo(r.dir, state);
    const ioB = testIo(wt, state);
    const runA = main(['review'], ioA);
    const runB = main(['review'], ioB);
    const portA = Number(URL_RE.exec(await ioA.waitFor(URL_RE))![1]);
    const portB = Number(URL_RE.exec(await ioB.waitFor(URL_RE))![1]);
    expect(portA).not.toBe(portB);
    expect(await main(['stop'], testIo(wt, state))).toBe(0);
    expect(await runB).toBe(0);
    expect((await request(portA, { path: '/' })).status).toBe(200);
    expect(await main(['stop'], testIo(r.dir, state))).toBe(0);
    expect(await runA).toBe(0);
  });
  it('.git이 읽기 전용이어도 review·보내기·comments·stop이 돈다 — .git과 작업 트리에 쓰지 않는다(Codex 샌드박스, 스펙 §5-3)', async () => {
    const r = repoWith({ 'a.md': '# A\n\none\n' }, { 'a.md': '# A\n\ntwo\n' });
    const before = r.git('status', '--porcelain');
    execFileSync('chmod', ['-R', 'a-w', join(r.dir, '.git')]);
    try {
      const state = tempDir();
      const io = testIo(r.dir, state);
      const running = main(['review'], io);
      const url = await io.waitFor(URL_RE);
      await sendOne(url, 'a.md', 3, 'x');
      expect(await main(['comments'], testIo(r.dir, state))).toBe(0);
      expect(await main(['stop'], testIo(r.dir, state))).toBe(0);
      expect(await running).toBe(0);
    } finally {
      execFileSync('chmod', ['-R', 'u+w', join(r.dir, '.git')]);
    }
    expect(r.git('status', '--porcelain')).toBe(before);
  });
  it('같은 worktree에서 review 둘이 거의 동시에 시작해도 서버는 하나 — 늦은 쪽은 "is starting"(1)이나 "already running"(0)', async () => {
    const r = repoWith({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    const state = tempDir();
    const ioA = testIo(r.dir, state);
    const ioB = testIo(r.dir, state);
    const runA = main(['review'], ioA);
    const runB = main(['review'], ioB);
    // 서버를 띄운 쪽은 stop까지 돌고, 다른 쪽은 곧 끝난다
    const quick = await Promise.race([runA.then((code) => ({ code, io: ioA, server: ioB, run: runB })), runB.then((code) => ({ code, io: ioB, server: ioA, run: runA }))]);
    const said = [...quick.io.lines, ...quick.io.errs].join('\n');
    if (quick.code === 0) expect(said).toContain('already running');
    else {
      expect(quick.code).toBe(1);
      expect(said).toContain('another markdown-diff-cat review is starting in this worktree');
    }
    await quick.server.waitFor(URL_RE);
    expect(existsSync(storeOf(r, state).file('server.starting'))).toBe(false);
    expect(await main(['stop'], testIo(r.dir, state))).toBe(0);
    expect(await quick.run).toBe(0);
  });
});

describe('최종 검토 고침', () => {
  it('바빠서 늦게 답하는 서버는 낡은 것으로 보지 않는다 — server.json을 지우지 않고 바쁘다고 말한다(review·stop 모두)', async () => {
    const r = repoWith({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    const state = tempDir();
    const store = storeOf(r, state);
    store.ensure('test');
    // 연결은 받지만 답하지 않는 서버(그리는 동안 이벤트 루프가 막힌 서버와 같다)
    const sockets: import('node:net').Socket[] = [];
    const busy = createServer((s) => void sockets.push(s));
    await new Promise<void>((ok) => busy.listen(0, '127.0.0.1', ok));
    const port = (busy.address() as AddressInfo).port;
    store.writeServer({ port, pid: process.pid, startedAt: '2026-10-18T00:00:00Z', controlSecret: 'x'.repeat(64), root: r.dir, version: 'test' });
    try {
      const io = testIo(r.dir, state);
      expect(await main(['review'], io)).toBe(1);
      expect(io.errs.join('\n')).toContain('busy');
      expect(existsSync(store.file('server.json'))).toBe(true);
      const stop = testIo(r.dir, state);
      expect(await main(['stop'], stop)).toBe(1);
      expect(stop.errs.join('\n')).toContain('busy');
      expect(existsSync(store.file('server.json'))).toBe(true);
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise((ok) => busy.close(ok));
    }
  }, 20_000);
  it('다시 review를 부를 때 --base를 주지 않으면 떠 있는 서버의 기준을 그대로 둔다', async () => {
    const r = repoWith({ 'a.md': 'a\n' }, {});
    r.git('tag', 'upstream-point');
    r.write('a.md', 'b\n');
    r.commit();
    r.write('a.md', 'c\n');
    const state = tempDir();
    const io = testIo(r.dir, state);
    const running = main(['review', '--base', 'upstream-point'], io);
    await io.waitFor(URL_RE);
    const again = testIo(r.dir, state);
    expect(await main(['review'], again)).toBe(0);
    const url = await again.waitFor(URL_RE);
    const port = Number(URL_RE.exec(url)![1]);
    const secret = await exchange(port, url);
    const view = JSON.parse((await request(port, { method: 'GET', path: '/api/view', headers: pageHeaders(port, secret) })).text);
    expect(view.baseText).toContain('upstream-point');
    io.abort();
    expect(await running).toBe(0);
  });
});

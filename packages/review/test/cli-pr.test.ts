import { afterEach, describe, expect, it } from 'vitest';
import { main, type Io } from '../src/cli';
import { stateBase, stateDirFor, StateStore } from '../src/state';
import { fakeComment, fakeGitHub, fakeRunner, fakeThread, type FakeGitHub } from './helpers/fake-github';
import { tempDir } from './helpers/git-repo';
import { exchange, pageHeaders, request } from './helpers/http';
import { prWorld, type PrWorld } from './helpers/pr-world';
import { join } from 'node:path';

const worlds: PrWorld[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.cleanup();
});

type TestIo = Io & { lines: string[]; errs: string[]; abort(): void; waitFor(re: RegExp): Promise<string> };
function testIo(cwd: string, state: string, gh: FakeGitHub): TestIo {
  const lines: string[] = [];
  const errs: string[] = [];
  const ac = new AbortController();
  return {
    cwd,
    env: { ...process.env, MDC_STATE_DIR: state },
    home: state,
    out: (t) => void lines.push(t),
    err: (t) => void errs.push(t),
    signal: ac.signal,
    open: () => {},
    selfPath: '/opt/mdc/markdown-diff-cat.mjs',
    gh: fakeRunner(gh),
    lines,
    errs,
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
const URL_RE = /http:\/\/localhost:(\d+)\/\?code=[0-9a-f]{32}/;

function setup(head: Record<string, string | null> = { 'docs/a.md': '# A\n\nnew line\n' }) {
  const w = prWorld({ base: { 'docs/a.md': '# A\n\nold line\n', 'code.ts': 'x\n' }, head });
  worlds.push(w);
  const gh = fakeGitHub({ pr: { url: w.view.url, number: 7, title: 'Docs', baseRefName: 'main', baseRefOid: w.base, headRefOid: w.head }, files: [{ filename: 'docs/a.md', patch: '@@ -1,3 +1,3 @@' }], threads: [fakeThread({ path: 'docs/a.md', line: 3, comments: { nodes: [fakeComment('octocat', 'Hmm')] } })] });
  const state = tempDir();
  const store = (() => {
    const base = stateBase({ MDC_STATE_DIR: state }, state);
    return new StateStore(base, stateDirFor(base, { root: w.clone.dir, commonDir: join(w.clone.dir, '.git') }), w.clone.dir);
  })();
  return { w, gh, state, store, io: () => testIo(w.clone.dir, state, gh) };
}

async function ping(store: StateStore): Promise<Record<string, unknown>> {
  const info = store.readServer()!;
  return (await (await fetch(`http://127.0.0.1:${info.port}/control/ping`, { headers: { 'x-mdc-control': info.controlSecret } })).json()) as Record<string, unknown>;
}

describe('review --pr', () => {
  it('--pr과 --since-last·--base는 같이 못 쓴다(2), 값이 틀리면 2, gh 없음·로그인 안 함은 1과 그 이유', async () => {
    const { gh, io } = setup();
    const a = io();
    expect(await main(['review', '--pr', '7', '--since-last'], a)).toBe(2);
    expect(a.errs[0]).toBe('markdown-diff-cat: --pr does not take --base or --since-last');
    expect(await main(['review', '--pr', 'acme/docs#7'], a)).toBe(2);
    expect(a.errs[1]).toBe('markdown-diff-cat: --pr takes a pull request number or a https://github.com/<owner>/<repo>/pull/<number> URL');
    gh.auth = 'missing';
    expect(await main(['review', '--pr', '7'], a)).toBe(1);
    expect(a.errs[2]).toBe('markdown-diff-cat: PR mode needs the GitHub CLI (gh): https://cli.github.com');
    gh.auth = 'logged-out';
    expect(await main(['review', '--pr', '7'], a)).toBe(1);
    expect(a.errs[3]).toBe('markdown-diff-cat: PR mode needs gh signed in to github.com:\nYou are not logged into any GitHub hosts. To log in, run: gh auth login');
  });

  it('서버를 띄우고 ping mode가 pr:acme/docs#7, 페이지는 PR 보기, stop --clean은 받은 ref도 지운다', async () => {
    const { w, gh, store, io } = setup();
    const a = io();
    const running = main(['review', '--pr', 'https://github.com/acme/docs/pull/7/files'], a);
    const url = await a.waitFor(URL_RE);
    const out = a.lines.join('\n');
    expect(out).toContain(`Reviewing acme/docs#7 "Docs" — base ${w.mergeBase.slice(0, 7)} → head ${w.head.slice(0, 7)} · 1 Markdown file`);
    expect(out).toContain('Comments go to your pending review only when you press "Add to pending review"; you submit the review on GitHub.');
    expect(out).toContain('This worktree is not on the head of pull request #7 — run gh pr checkout 7 before an agent edits the files.');
    expect(gh.calls[0]).toEqual(['auth', 'status', '--hostname', 'github.com']);
    expect(gh.calls[1]).toEqual(['pr', 'view', 'https://github.com/acme/docs/pull/7', '--json', 'url,number,title,baseRefName,baseRefOid,headRefOid']);
    expect(await ping(store)).toMatchObject({ mode: 'pr:acme/docs#7', root: w.clone.dir });
    const port = Number(URL_RE.exec(url)![1]);
    const secret = await exchange(port, url);
    const view = JSON.parse((await request(port, { path: '/api/view', headers: pageHeaders(port, secret) })).text);
    expect(view.pr).toMatchObject({ owner: 'acme', repo: 'docs', number: 7, head: w.head.slice(0, 7) });
    const threads = JSON.parse((await request(port, { path: '/api/threads?path=docs%2Fa.md', headers: pageHeaders(port, secret) })).text);
    expect(threads.threads[0].comments[0].body).toBe('Hmm');
    expect(w.clone.git('for-each-ref', '--format=%(refname)', 'refs/markdown-diff-cat/')).toContain('refs/markdown-diff-cat/pr/7/head');
    const stop = io();
    expect(await main(['stop', '--clean'], stop)).toBe(0);
    expect(stop.lines.join('\n')).toContain('Removed 2 fetched pull request refs (refs/markdown-diff-cat/).');
    expect(await running).toBe(0);
    expect(w.clone.git('for-each-ref', '--format=%(refname)', 'refs/markdown-diff-cat/')).toBe('');
  });

  it('작업 트리 서버가 떠 있으면 review --pr은 1(stop 안내), 같은 PR이면 새 주소, PR 서버에 작업 트리 review도 1', async () => {
    const { w, io } = setup();
    w.clone.write('docs/a.md', '# A\n\nlocal\n');
    const wt = io();
    const runWt = main(['review'], wt);
    const wtUrl = await wt.waitFor(URL_RE);
    const port = URL_RE.exec(wtUrl)![1];
    const clash = io();
    expect(await main(['review', '--pr', '7'], clash)).toBe(1);
    expect(clash.errs[0]).toBe(`markdown-diff-cat: A review server for the working tree is already running in this worktree (port ${port}) — run markdown-diff-cat stop first.`);
    expect(await main(['stop'], io())).toBe(0);
    expect(await runWt).toBe(0);

    const pr = io();
    const runPr = main(['review', '--pr', '7'], pr);
    const prUrl = await pr.waitFor(URL_RE);
    const prPort = URL_RE.exec(prUrl)![1];
    const again = io();
    expect(await main(['review', '--pr', '7'], again)).toBe(0);
    expect(again.lines.join('\n')).toContain(`A review server is already running for this worktree (port ${prPort}).`);
    expect(await again.waitFor(URL_RE)).not.toBe(prUrl);
    const wt2 = io();
    expect(await main(['review'], wt2)).toBe(1);
    expect(wt2.errs[0]).toBe(`markdown-diff-cat: A review server for acme/docs#7 is already running in this worktree (port ${prPort}) — run markdown-diff-cat stop first.`);
    expect(await main(['stop'], io())).toBe(0);
    expect(await runPr).toBe(0);
  });

  it('PR에 md 변경이 없으면 서버 없이 0', async () => {
    const { io, store } = setup({ 'code.ts': 'y\n' });
    const a = io();
    expect(await main(['review', '--pr', '7'], a)).toBe(0);
    expect(a.lines.join('\n')).toContain('No Markdown changes in acme/docs#7.');
    expect(store.readServer()).toBeNull();
  });
});

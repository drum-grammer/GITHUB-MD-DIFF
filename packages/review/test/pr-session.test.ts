import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../src/errors';
import { Gh } from '../src/gh';
import { formatRound } from '../src/handoff';
import { fetchPr } from '../src/pr';
import { PrSession } from '../src/pr-session';
import { ReviewSession } from '../src/session';
import { StateStore, stateDirFor } from '../src/state';
import type { PrRef } from '../src/records';
import { fakeComment, fakeGitHub, fakeRunner, fakeThread, type FakeGitHub } from './helpers/fake-github';
import { tempDir } from './helpers/git-repo';
import { prWorld, type PrWorld } from './helpers/pr-world';

const worlds: PrWorld[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) w.cleanup();
});

const OLD = '# Guide\n\n## Install\n\nInstall it.\n\n## Use\n\nUse it often.\n\n## Notes\n\nOld note.\n';
const NEW = OLD.replace('Old note.', 'New note.');
// GitHub가 준 hunk — 양쪽 10–13줄
const PATCH = '@@ -10,4 +10,4 @@ Use it often.\n \n ## Notes\n \n-Old note.\n+New note.';

function setup(over: (gh: FakeGitHub, w: PrWorld) => void = () => {}) {
  const w = prWorld({ base: { 'docs/guide.md': OLD, 'docs/keep.md': '# Keep\n' }, head: { 'docs/guide.md': NEW } });
  worlds.push(w);
  const pr = fetchPr(w.clone.dir, w.view);
  const T1 = fakeThread({ path: 'docs/guide.md', line: 13, comments: { nodes: [fakeComment('octocat', 'Is this note still true?')] } });
  const T2 = fakeThread({ path: 'docs/guide.md', subjectType: 'FILE', line: null, comments: { nodes: [fakeComment('me', 'Whole file looks good.')] } });
  const T3 = fakeThread({ path: 'docs/guide.md', line: 5, isOutdated: true, comments: { nodes: [fakeComment('octocat', 'old')] } });
  const gh = fakeGitHub({ pr: { url: w.view.url, number: 7, title: 'Docs', baseRefName: 'main', baseRefOid: w.base, headRefOid: w.head }, threads: [T1, T2, T3], files: [{ filename: 'docs/guide.md', patch: PATCH }] });
  over(gh, w);
  const base = tempDir('mdc-state-');
  const store = new StateStore(base, stateDirFor(base, { root: w.clone.dir, commonDir: join(w.clone.dir, '.git') }), w.clone.dir);
  store.ensure('1.6.0');
  let tick = 0;
  const session = new PrSession({ root: w.clone.dir, store, view: 'merge-base', pr, gh: new Gh(fakeRunner(gh), w.clone.dir), now: () => new Date(2026, 9, 23, 10, 0, tick++) });
  return { w, pr, gh, store, session, T1, T2, T3 };
}

const statusOf = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
  return 0;
};

describe('PrSession', () => {
  it('PR 판 — 두 쪽 git 객체, 작업 트리 변경은 섞이지 않는다, 판 mode pr', () => {
    const { w, pr, session, store } = setup();
    w.clone.write('docs/guide.md', 'local edit\n');
    const view = session.view();
    expect(view.files.map((f) => f.path)).toEqual(['docs/guide.md']);
    expect(view.files[0].newText).toBe(NEW);
    expect(view.baseText).toBe(`${pr.mergeBase.slice(0, 7)} (merge-base of acme/docs#7)`);
    expect(view.pr).toEqual({ owner: 'acme', repo: 'docs', number: 7, url: 'https://github.com/acme/docs/pull/7', title: 'Docs', head: pr.headOid.slice(0, 7) });
    expect(view.sinceLastAvailable).toBe(false);
    expect(view.notices).toEqual([{ key: 'reviewNoticePrCheckout', subs: ['7'] }]);
    const record = store.loadRender(view.rev)!;
    expect(record).toMatchObject({ mode: 'pr', pr, baseOid: pr.mergeBase, baseLabel: 'merge-base of acme/docs#7', files: { 'docs/guide.md': NEW }, shown: ['docs/guide.md'] });
    expect(session.poll(view.rev)).toEqual({ changed: false, superseded: false });
  });

  it('스레드 — GitHub 스레드에 내 답글 초안이 붙고, 숨긴 낡은 스레드 수', async () => {
    const { session, T1, T2 } = setup();
    const rev = session.view().rev;
    const first = await session.apiThreads('docs/guide.md');
    expect(first.threads.map((t) => t.id)).toEqual([T1.id, T2.id]);
    expect(first.hidden).toBe(1);
    expect(first.github).toEqual({ [T1.id]: { others: 1 } });
    const reply = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 0, end: 0, body: 'Yes, still true.', replyTo: T1.id });
    expect(reply).toMatchObject({ replyTo: T1.id, side: 'new', start: 13, end: 13, quote: 'New note.', scope: 'pr:acme/docs#7' });
    const line = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 5, end: 5, body: 'Say how.' });
    const next = await session.apiThreads('docs/guide.md');
    expect(next.threads.map((t) => t.id)).toEqual([T1.id, T2.id, line.id]);
    expect(next.threads[0].comments.at(-1)).toMatchObject({ id: reply.id, author: 'you', body: 'Yes, still true.', canEdit: true, canDelete: true, pending: false });
    expect(session.draftCount()).toBe(2);
    expect(() => session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 0, end: 0, body: 'x', replyTo: 'PRRT_gone' })).toThrow('This thread is not on the pull request any more — press Redraw.');
    // 파일 전체 스레드의 답글 — 줄이 없다
    expect(session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 0, end: 0, body: 'ok', replyTo: T2.id })).toMatchObject({ start: 0, end: 0, quote: '' });
  });

  it('보류 중 리뷰에 넣기 — 맞춘 줄·파일 스레드·답글, 성공한 초안만 지운다', async () => {
    const { session, gh, store, T1 } = setup();
    const rev = session.view().rev;
    await session.apiThreads('docs/guide.md');
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 13, end: 13, body: 'fits' });
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 9, end: 13, body: 'clipped' });
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 5, end: 5, body: 'folded' });
    session.addDraft({ rev, path: 'docs/guide.md', side: 'left', start: 13, end: 13, body: 'old side' });
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 0, end: 0, body: 'reply', replyTo: T1.id });
    const res = await session.apiPush(rev);
    expect(res).toEqual({ added: 5, failed: [], url: 'https://github.com/acme/docs/pull/7/files' });
    expect(gh.createdReviews).toBe(1);
    expect(gh.mutations).toEqual([
      { name: 'addPullRequestReviewThread', input: { pullRequestReviewId: 'PRR_new', path: 'docs/guide.md', body: 'fits', subjectType: 'LINE', line: 13, side: 'RIGHT' } },
      { name: 'addPullRequestReviewThread', input: { pullRequestReviewId: 'PRR_new', path: 'docs/guide.md', body: '`L9–13` — trimmed to `L10–13`, the changed lines GitHub accepts\n\nclipped', subjectType: 'LINE', line: 13, side: 'RIGHT', startLine: 10, startSide: 'RIGHT' } },
      { name: 'addPullRequestReviewThread', input: { pullRequestReviewId: 'PRR_new', path: 'docs/guide.md', body: '`L5` (unchanged lines; GitHub accepts line comments only on changed lines)\n\n```text\nInstall it.\n```\n\nfolded', subjectType: 'FILE' } },
      { name: 'addPullRequestReviewThread', input: { pullRequestReviewId: 'PRR_new', path: 'docs/guide.md', body: 'old side', subjectType: 'LINE', line: 13, side: 'LEFT' } },
      { name: 'addPullRequestReviewThreadReply', input: { pullRequestReviewId: 'PRR_new', pullRequestReviewThreadId: T1.id, body: 'reply' } },
    ]);
    expect(store.drafts()).toEqual([]);
    // 다시 읽으면 넣은 것이 Pending으로 — 두 번째 넣기는 같은 보류 중 리뷰에
    const after = await session.apiThreads('docs/guide.md');
    expect(after.threads.find((t) => t.id === T1.id)!.comments.at(-1)).toMatchObject({ body: 'reply', pending: true, author: 'me' });
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 13, end: 13, body: 'second' });
    await session.apiPush(rev);
    expect(gh.createdReviews).toBe(1);
    expect(gh.mutations.at(-1)!.input.pullRequestReviewId).toBe('PRR_new');
  });

  it('실패한 것만 초안으로 남기고 이유를 돌려준다', async () => {
    const { session, store } = setup((gh) => {
      gh.files = [{ filename: 'docs/other.md', patch: PATCH }];
    });
    const rev = session.view().rev;
    const d = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 13, end: 13, body: 'x' });
    expect(await session.apiPush(rev)).toEqual({ added: 0, failed: [{ id: d.id, path: 'docs/guide.md', lines: 'L13', error: 'docs/guide.md is not among the changed files of the pull request' }], url: 'https://github.com/acme/docs/pull/7/files' });
    expect(store.drafts().map((x) => x.id)).toEqual([d.id]);
  });

  it('새 커밋이면 아무것도 넣지 않는다(409)', async () => {
    const { session, gh, store } = setup((g) => {
      g.head = 'f'.repeat(40);
    });
    const rev = session.view().rev;
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 13, end: 13, body: 'x' });
    await expect(session.apiPush(rev)).rejects.toMatchObject({ status: 409, message: 'New commits were pushed to acme/docs#7 after this view — press Redraw, check your comments, and add them again.' });
    expect(gh.mutations).toEqual([]);
    expect(gh.createdReviews).toBe(0);
    expect(store.drafts()).toHaveLength(1);
    expect(await statusOf(session.apiPush('rzzzzz'))).toBe(409);
  });

  it('에이전트에게 보내기 — 남의 스레드는 고른 것만, excluded 수, base → head, 체크아웃 경고', async () => {
    const { session, store, pr, T1, gh } = setup();
    gh.threads.push(fakeThread({ path: 'docs/guide.md', line: 9, comments: { nodes: [fakeComment('hubot', 'Not included')] } }));
    // md가 아닌 파일의 스레드는 화면에 없다 — 뺀 수에 세지 않는다
    gh.threads.push(fakeThread({ path: 'src/app.ts', line: 2, comments: { nodes: [fakeComment('hubot', 'code review'), fakeComment('octocat', 'agreed')] } }));
    const rev = session.view().rev;
    await session.apiThreads('docs/guide.md');
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 13, end: 13, body: 'Mine.' });
    expect(await session.apiSend(rev, [T1.id])).toEqual({ round: 1, comments: 2 });
    const round = store.rounds()[0];
    expect(round).toMatchObject({ mode: 'pr', base: { kind: 'pr', oid: pr.mergeBase, head: pr.headOid, label: 'acme/docs#7' }, excluded: 1, changedAfterRender: false });
    expect(round.warning).toBe(`HEAD is not the head of acme/docs#7 (${pr.headOid.slice(0, 7)}) — line numbers refer to the pull request head. Run gh pr checkout 7 before editing.`);
    expect(round.comments.map((c) => ({ author: c.author, body: c.body, start: c.start, quote: c.quote, mode: c.mode }))).toEqual([
      { author: 'you', body: 'Mine.', start: 13, quote: 'New note.', mode: 'pr' },
      { author: '@octocat', body: 'Is this note still true?', start: 13, quote: 'New note.', mode: 'pr' },
    ]);
    const md = formatRound(round);
    expect(md.split('\n')[0]).toBe(`<!-- markdown-diff-cat round 1 · 2026-10-23T10:00+09:00 · base ${pr.mergeBase.slice(0, 7)} (merge-base of acme/docs#7) → head ${pr.headOid.slice(0, 7)} · review render ${rev} -->`);
    expect(md).toContain(`> Warning: HEAD is not the head of acme/docs#7`);
    expect(md).toContain('(you 1 · others 1 · excluded 1)');
    expect(md).toContain('author: @octocat (others)\n````text\nNew note.\n````\n````text\nIs this note still true?\n````'.replace(/````/g, '```'));
    expect(store.drafts()).toEqual([]);
    await expect(session.apiSend(rev, [])).rejects.toMatchObject({ status: 400, message: 'Add a comment first.' });
    await expect(session.apiSend(rev, ['PRRT_none'])).rejects.toMatchObject({ status: 400 });
  });

  it('작업 트리 초안은 PR 세션에 안 보이고, PR 초안은 작업 트리 세션에 안 보인다', async () => {
    const { w, session, store } = setup();
    w.clone.write('docs/keep.md', '# Keep\n\nlocal\n');
    const worktree = new ReviewSession({ root: w.clone.dir, store, view: 'merge-base' });
    const wrev = worktree.view().rev;
    worktree.addDraft({ rev: wrev, path: 'docs/keep.md', side: 'right', start: 3, end: 3, body: 'worktree' });
    const rev = session.view().rev;
    expect(session.draftCount()).toBe(0);
    expect(session.view().offView).toEqual([]);
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 13, end: 13, body: 'pr' });
    expect(worktree.draftCount()).toBe(1);
    expect(session.draftCount()).toBe(1);
    expect((await session.apiThreads('docs/guide.md')).threads.filter((t) => t.id.startsWith('d'))).toHaveLength(1);
  });

  it('GitHub를 못 읽어도 내 초안은 보이고 이유를 알린다', async () => {
    const { session, gh } = setup();
    const rev = session.view().rev;
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 13, end: 13, body: 'x' });
    gh.auth = 'missing';
    const t = await session.apiThreads('docs/guide.md');
    expect(t.threads).toHaveLength(1);
    expect(t.githubError).toBe('PR mode needs the GitHub CLI (gh): https://cli.github.com');
    gh.auth = undefined;
    expect((await session.apiThreads('docs/guide.md')).threads).toHaveLength(3);
  });

  /** PR에 새 커밋 — 맨 위에 네 줄을 끼워 "New note."가 17줄로 내려간다 */
  function pushNewHead(w: PrWorld, gh: FakeGitHub): { head: string; text: string } {
    w.author.git('checkout', '-q', 'feature');
    const text = `Intro one.\n\nIntro two.\n\n${NEW}`;
    w.author.write('docs/guide.md', text);
    const head = w.author.commit('more');
    w.author.git('push', '-q', '-f', 'origin', 'feature:refs/pull/7/head');
    w.author.git('checkout', '-q', 'main');
    gh.pr.headRefOid = head;
    gh.head = head;
    gh.files = [{ filename: 'docs/guide.md', patch: '@@ -1,13 +1,17 @@\n+Intro one.' }];
    return { head, text };
  }
  const withRefetch = (w: PrWorld, gh: FakeGitHub, store: StateStore, pr: PrRef) => {
    const ghc = new Gh(fakeRunner(gh), w.clone.dir);
    return new PrSession({ root: w.clone.dir, store, view: 'merge-base', pr, gh: ghc, refetch: async () => fetchPr(w.clone.dir, await ghc.prView('7')) });
  };

  it('다시 그리기는 PR을 다시 받는다 — 새 head로 그리고, 그 줄로 넣는다', async () => {
    const { w, gh, store, pr } = setup();
    const session = withRefetch(w, gh, store, pr);
    session.view();
    const { head, text } = pushNewHead(w, gh);
    const v2 = await session.apiRedraw();
    expect(v2.pr!.head).toBe(head.slice(0, 7));
    expect(v2.files[0].newText).toBe(text);
    session.addDraft({ rev: v2.rev, path: 'docs/guide.md', side: 'right', start: 17, end: 17, body: 'after redraw' });
    expect(await session.apiPush(v2.rev)).toMatchObject({ added: 1, failed: [] });
    expect(gh.mutations.at(-1)!.input).toMatchObject({ line: 17, side: 'RIGHT', body: 'after redraw' });
  });

  it('줄이 바뀐 초안은 넣지 않고 이유를 돌려준다(옛 줄 번호로 엉뚱한 줄에 가지 않게)', async () => {
    const { w, gh, store, pr } = setup();
    const session = withRefetch(w, gh, store, pr);
    const rev = session.view().rev;
    const d = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 13, end: 13, body: 'about New note' });
    pushNewHead(w, gh);
    const v2 = await session.apiRedraw();
    expect(store.drafts()[0]).toMatchObject({ id: d.id, moved: true });
    expect((await session.apiDrafts()).drafts).toEqual([{ id: d.id, path: 'docs/guide.md', lines: 'L13', excerpt: 'about New note', place: { kind: 'stale' } }]);
    expect(await session.apiPush(v2.rev)).toEqual({ added: 0, failed: [{ id: d.id, path: 'docs/guide.md', lines: 'L13', error: 'The lines changed since you wrote this — delete it and comment again in the right place.' }], url: 'https://github.com/acme/docs/pull/7/files' });
    expect(gh.mutations).toEqual([]);
    expect(store.drafts().map((x) => x.id)).toEqual([d.id]);
  });

  it('확인 상자 미리보기 — 줄 그대로·잘림·파일 전체·답글·PR 밖을 초안마다(스펙 §6-3)', async () => {
    const { session, T1, gh } = setup();
    const rev = session.view().rev;
    await session.apiThreads('docs/guide.md');
    const a = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 13, end: 13, body: 'fits' });
    const b = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 9, end: 13, body: 'clipped' });
    const c = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 5, end: 5, body: 'folded' });
    const r = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 0, end: 0, body: 'reply', replyTo: T1.id });
    expect((await session.apiDrafts()).drafts.map((x) => [x.id, x.place])).toEqual([
      [a.id, { kind: 'line' }],
      [b.id, { kind: 'trimmed', lines: 'L10–13' }],
      [c.id, { kind: 'file' }],
      [r.id, { kind: 'reply' }],
    ]);
    gh.files = [];
    expect((await session.apiDrafts()).drafts[0].place).toEqual({ kind: 'error', error: 'docs/guide.md is not among the changed files of the pull request' });
    gh.auth = 'missing';
    expect((await session.apiDrafts()).drafts[0].place).toBeUndefined(); // GitHub를 못 읽으면 미리보기 없이 목록만
  });

  it('넣는 도중 두 번째 넣기는 409, 들어간 초안은 그때그때 지운다(중간에 끊겨도 다시 넣지 않게)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((ok) => (release = ok));
    let reached!: () => void;
    const second = new Promise<void>((ok) => (reached = ok));
    const { session, store } = setup((g) => {
      g.beforeMutation = async (n) => {
        if (n === 1) {
          reached();
          await gate;
        }
      };
    });
    const rev = session.view().rev;
    const a = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 13, end: 13, body: 'one' });
    const b = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 12, end: 12, body: 'two' });
    const first = session.apiPush(rev);
    await second;
    expect(store.drafts().map((d) => d.id)).toEqual([b.id]);
    await expect(session.apiPush(rev)).rejects.toMatchObject({ status: 409, message: 'Adding to your pending review is already in progress — wait for it to finish.' });
    release();
    expect(await first).toMatchObject({ added: 2, failed: [] });
    expect(store.drafts()).toEqual([]);
    void a;
  });
});

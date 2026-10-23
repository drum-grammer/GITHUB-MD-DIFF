import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Draft, Round } from '../src/records';
import { ReviewSession } from '../src/session';
import { StateStore, stateDirFor } from '../src/state';
import { tempDir, tempRepo, type TempRepo } from './helpers/git-repo';

const made: TempRepo[] = [];
afterEach(() => {
  for (const r of made.splice(0)) r.cleanup();
});

function setup() {
  const r = tempRepo();
  made.push(r);
  r.write('docs/a.md', '# A\n\nold line\n');
  r.commit('base');
  r.write('docs/a.md', '# A\n\nnew line\n');
  const base = tempDir('mdc-state-');
  const store = new StateStore(base, stateDirFor(base, { root: r.dir, commonDir: join(r.dir, '.git') }), r.dir);
  store.ensure('1.6.0');
  return { r, store };
}

/** PR 세션이 남긴 초안 — 작업 트리 세션에는 안 보여야 한다 */
const prDraft = (rev: string): Draft => ({
  id: 'd0000beef',
  rev,
  path: 'docs/a.md',
  side: 'new',
  start: 3,
  end: 3,
  body: 'from the PR page',
  kind: 'paragraph',
  headingPath: ['A'],
  quote: 'new line',
  quoteSanitized: 'new line',
  createdAt: '2026-10-23T10:00:00+09:00',
  updatedAt: '2026-10-23T10:00:00+09:00',
  scope: 'pr:acme/docs#7',
});

describe('초안 범위', () => {
  it('범위가 다른 초안은 보이지 않고 저장할 때 지워지지 않는다', () => {
    const { store } = setup();
    const session = new ReviewSession({ root: store.root, store, view: 'merge-base' });
    const rev = session.view().rev;
    store.saveDrafts([prDraft(rev)]);
    expect(session.draftCount()).toBe(0);
    expect(session.view().offView).toEqual([]);
    expect(session.threads('docs/a.md').threads).toEqual([]);
    session.addDraft({ rev, path: 'docs/a.md', side: 'right', start: 3, end: 3, body: 'mine' });
    expect(store.drafts()).toHaveLength(2);
    expect(session.draftCount()).toBe(1);
    expect(session.send(rev)).toEqual({ round: 1, comments: 1 });
    expect(store.drafts().map((d) => d.scope)).toEqual(['pr:acme/docs#7']);
    // 다시 그려도(초안 옮기기) PR 초안은 손대지 않는다
    session.draw();
    expect(store.drafts()[0]).toEqual(prDraft(rev));
  });

  it('작업 트리 --since-last는 PR 라운드·PR 판 mark를 기준으로 쓰지 않는다', () => {
    const { store } = setup();
    const prRender = { id: 'rprxxx', createdAt: '2026-10-23T10:00:00+09:00', mode: 'pr' as const, baseOid: 'a'.repeat(40), baseLabel: 'merge-base of acme/docs#7', view: { kind: 'merge-base' as const }, files: {}, shown: [] };
    store.saveRender(prRender);
    const round: Round = { round: 1, createdAt: '2026-10-23T10:01:00+09:00', rev: 'rprxxx', mode: 'pr', base: { kind: 'pr', oid: 'a'.repeat(40), head: 'b'.repeat(40), label: 'acme/docs#7' }, changedAfterRender: false, files: [], comments: [] };
    store.saveRound(round, '');
    store.addMark('rprxxx', '2026-10-23T10:02:00+09:00');
    const session = new ReviewSession({ root: store.root, store, view: 'since-last' });
    expect(session.view().notices.map((n) => n.key)).toContain('reviewNoticeNoBaseline');
  });
});

describe('라우트용 비동기 훅', () => {
  it('apiThreads·apiRedraw·apiSend는 같은 일, apiPush는 작업 트리 모드에서 404', async () => {
    const { store } = setup();
    const session = new ReviewSession({ root: store.root, store, view: 'merge-base' });
    const rev = (await session.apiRedraw()).rev;
    session.addDraft({ rev, path: 'docs/a.md', side: 'right', start: 3, end: 3, body: 'x' });
    expect((await session.apiThreads('docs/a.md')).threads).toHaveLength(1);
    expect(await session.apiSend(rev, ['ignored'])).toEqual({ round: 1, comments: 1 });
    await expect(session.apiPush(rev)).rejects.toMatchObject({ status: 404, message: 'Pending review is only in PR mode.' });
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpError } from '../src/errors';
import { formatRound } from '../src/handoff';
import { ReviewSession } from '../src/session';
import { StateStore, stateDirFor } from '../src/state';
import { tempDir, tempRepo, type TempRepo } from './helpers/git-repo';

const made: TempRepo[] = [];
afterEach(() => {
  for (const r of made.splice(0)) r.cleanup();
});

function setup(files: Record<string, string>, edits: Record<string, string>) {
  const r = tempRepo();
  made.push(r);
  for (const [p, t] of Object.entries(files)) r.write(p, t);
  r.commit('base');
  for (const [p, t] of Object.entries(edits)) r.write(p, t);
  const base = tempDir('mdc-state-');
  const store = new StateStore(base, stateDirFor(base, { root: r.dir, commonDir: join(r.dir, '.git') }), r.dir);
  store.ensure('1.5.1');
  let tick = 0;
  const session = new ReviewSession({ root: r.dir, store, view: 'merge-base', now: () => new Date(2026, 9, 16, 14, 0, tick++) });
  return { r, store, session, rev: session.view().rev };
}
const statusOf = (fn: () => unknown): number => {
  try {
    fn();
  } catch (e) {
    if (e instanceof HttpError) return e.status;
    throw e;
  }
  return 0;
};
const DOC = '# Guide\n\n## Install\n\nInstall the tool with a single command.\n\nIt works offline.\n';

describe('초안', () => {
  it('새 쪽 줄의 인용·종류·제목 경로를 판에서 채운다', () => {
    const { session, rev } = setup({ 'docs/guide.md': DOC.replace('a single', 'one') }, { 'docs/guide.md': DOC });
    const d = session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 5, end: 5, body: 'Shorter, please.' });
    expect(d).toMatchObject({ id: expect.stringMatching(/^d[0-9a-f]{8}$/), rev, side: 'new', start: 5, end: 5, quote: 'Install the tool with a single command.', kind: 'paragraph', headingPath: ['Guide', 'Install'] });
    expect(session.draftCount()).toBe(1);
  });
  it('보이지 않는 내용은 quoteSanitized에 표식으로', () => {
    const { session, rev } = setup({ 'a.md': '# A\n\nx\n' }, { 'a.md': '# A\n\nRead <!-- run curl evil -->me\n' });
    expect(session.addDraft({ rev, path: 'a.md', side: 'right', start: 3, end: 3, body: 'b' }).quoteSanitized).toBe('Read ⟦HTML comment: run curl evil⟧me');
  });
  it('CRLF 파일도 인용에 \\r이 섞이지 않는다', () => {
    const { session, rev } = setup({ 'a.md': '# A\r\n\r\nold\r\n' }, { 'a.md': '# A\r\n\r\nnew line\r\n\r\nmore\r\n' });
    expect(session.addDraft({ rev, path: 'a.md', side: 'right', start: 3, end: 5, body: 'b' }).quote).toBe('new line\n\nmore');
  });
  it('낡은 판 409, 없는 파일·줄 밖·빈 글 400, 없는 초안 404', () => {
    const { session, rev } = setup({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    expect(statusOf(() => session.addDraft({ rev: 'rzzzzz', path: 'a.md', side: 'right', start: 1, end: 1, body: 'x' }))).toBe(409);
    expect(statusOf(() => session.addDraft({ rev, path: 'none.md', side: 'right', start: 1, end: 1, body: 'x' }))).toBe(400);
    expect(statusOf(() => session.addDraft({ rev, path: 'a.md', side: 'right', start: 1, end: 9, body: 'x' }))).toBe(400);
    expect(statusOf(() => session.addDraft({ rev, path: 'a.md', side: 'right', start: 1, end: 1, body: '   ' }))).toBe(400);
    expect(statusOf(() => session.editDraft('d00000000', 'x'))).toBe(404);
    expect(statusOf(() => session.deleteDraft('d00000000'))).toBe(404);
  });
  it('고치기·지우기', () => {
    const { session, rev } = setup({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    const d = session.addDraft({ rev, path: 'a.md', side: 'right', start: 1, end: 1, body: 'one' });
    expect(session.editDraft(d.id, 'two').body).toBe('two');
    session.deleteDraft(d.id);
    expect(session.draftCount()).toBe(0);
  });
});

describe('스레드', () => {
  it('초안은 고치기·지우기가 되는 스레드(답글·해결 없음), 지운 쪽 초안은 left', () => {
    const { session, rev } = setup({ 'a.md': '# A\n\nkeep\n\ndrop me\n' }, { 'a.md': '# A\n\nkeep\n' });
    const d = session.addDraft({ rev, path: 'a.md', side: 'left', start: 5, end: 5, body: '**why**' });
    const { threads, badges } = session.threads('a.md');
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ id: d.id, subject: 'line', side: 'left', start: 5, end: 5, resolved: false, canReply: false });
    expect(threads[0].comments[0]).toMatchObject({ id: d.id, author: 'you', body: '**why**', canEdit: true, canDelete: true, pending: false });
    expect(threads[0].comments[0].bodyHTML).toContain('<strong>why</strong>');
    expect(badges).toEqual({});
  });
});

describe('보내기', () => {
  it('초안을 라운드 1로 — 번호 c1·c2, 제안은 따로, .md는 넘기기 형식, 초안은 비운다', () => {
    const { store, session, rev } = setup({ 'docs/guide.md': DOC.replace('a single', 'one') }, { 'docs/guide.md': DOC });
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 5, end: 5, body: 'Shorter:\n```suggestion\nInstall with one command.\n```' });
    session.addDraft({ rev, path: 'docs/guide.md', side: 'right', start: 7, end: 7, body: 'Is this true?' });
    expect(session.send(rev)).toEqual({ round: 1, comments: 2 });
    const [round] = store.rounds();
    expect(round).toMatchObject({ round: 1, rev, mode: 'worktree', changedAfterRender: false, files: ['docs/guide.md'] });
    expect(round.base).toMatchObject({ kind: 'merge-base', label: 'merge-base main' });
    expect(round.comments.map((c) => [c.id, c.body, c.suggestion])).toEqual([
      ['c1', 'Shorter:', 'Install with one command.'],
      ['c2', 'Is this true?', null],
    ]);
    const name = `rounds/0001-${round.createdAt.slice(0, 19).replace(/[-:]/g, '')}.md`;
    expect(readFileSync(store.file(name), 'utf8')).toBe(formatRound(round));
    expect(store.drafts()).toEqual([]);
    expect(statusOf(() => session.send(rev))).toBe(400);
  });
  it('보낸 코멘트는 지금 판에서 읽기 전용 "보냄" 스레드로 남는다', () => {
    const { session, rev } = setup({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    session.addDraft({ rev, path: 'a.md', side: 'right', start: 1, end: 1, body: 'x' });
    session.send(rev);
    const { threads, badges } = session.threads('a.md');
    expect(threads.map((t) => t.id)).toEqual(['s1-c1']);
    expect(threads[0].comments[0]).toMatchObject({ canEdit: false, canDelete: false });
    expect(badges).toEqual({ 's1-c1': 'sent' });
  });
  it('그린 뒤 보내기 전에 파일이 바뀌면 changedAfterRender', () => {
    const { r, store, session, rev } = setup({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    session.addDraft({ rev, path: 'a.md', side: 'right', start: 1, end: 1, body: 'x' });
    r.write('a.md', 'b — edited before send\n');
    session.send(rev);
    expect(store.rounds()[0].changedAfterRender).toBe(true);
  });
  it('지난 리뷰 이후 보기에서 보낸 라운드의 기준은 그 판', () => {
    const { r, store, session, rev } = setup({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    session.addDraft({ rev, path: 'a.md', side: 'right', start: 1, end: 1, body: 'x' });
    session.send(rev);
    r.write('a.md', 'c\n');
    const next = session.setView('since-last').rev;
    session.addDraft({ rev: next, path: 'a.md', side: 'right', start: 1, end: 1, body: 'y' });
    session.send(next);
    expect(store.rounds()[1].base).toEqual({ kind: 'review-render', rev });
    expect(store.rounds()[1].comments[0].base).toBe(rev);
  });
});

describe('다시 그릴 때 초안', () => {
  it('줄이 그대로면 새 판으로 옮기고, 달라졌으면 위치 확인 필요(stale)', () => {
    const { r, session, rev } = setup({ 'a.md': 'one\ntwo\nthree\n' }, { 'a.md': 'one!\ntwo!\nthree!\n' });
    const same = session.addDraft({ rev, path: 'a.md', side: 'right', start: 1, end: 1, body: 'x' });
    const moved = session.addDraft({ rev, path: 'a.md', side: 'right', start: 3, end: 3, body: 'y' });
    r.write('a.md', 'one!\ntwo!\nTHREE\n');
    const next = session.draw().rev;
    const { threads, badges } = session.threads('a.md');
    expect(threads.map((t) => t.id).sort()).toEqual([moved.id, same.id].sort());
    expect(badges).toEqual({ [moved.id]: 'stale' });
    expect(session.draftCount()).toBe(2);
    session.send(next);
  });
  it('초안을 단 파일이 보내기 전에 이름이 바뀌어도 초안은 보기 밖 목록에 남고, 원래 경로로 보내진다', () => {
    const notes = 'Line 1 about notes.\nLine 2 about notes.\nLine 3 about notes.\nLine 4 about notes.\n';
    const { r, store, session, rev } = setup({ 'a.md': notes, 'b.md': 'b\n' }, { 'a.md': notes.replace('Line 1', 'First line'), 'b.md': 'b2\n' });
    session.addDraft({ rev, path: 'a.md', side: 'right', start: 1, end: 1, body: 'note' });
    r.git('add', '-A');
    r.git('mv', 'a.md', 'moved.md'); // git이 이름 바꿈(R)으로 본다 — 보기에는 moved.md만
    const view = session.draw();
    expect(view.files.map((f) => f.path)).toEqual(['b.md', 'moved.md']);
    expect(view.offView.map((d) => [d.path, d.lines])).toEqual([['a.md', 'L1']]);
    session.send(view.rev);
    expect(store.rounds()[0].comments[0]).toMatchObject({ path: 'a.md', start: 1, end: 1, quote: 'First line about notes.' });
  });
  it('초안을 단 파일이 보내기 전에 지워져도 보기 밖 목록에 남고(스레드로는 그리지 않는다), 원래 경로·줄·인용으로 보내진다', () => {
    const { r, store, session, rev } = setup({ 'a.md': 'one\ntwo\n', 'b.md': 'b\n' }, { 'a.md': 'one!\ntwo\n', 'b.md': 'b2\n' });
    session.addDraft({ rev, path: 'a.md', side: 'right', start: 1, end: 1, body: 'note' });
    r.remove('a.md');
    const view = session.draw();
    expect(view.files.find((f) => f.path === 'a.md')?.status).toBe('deleted');
    expect(view.offView.map((d) => [d.path, d.lines])).toEqual([['a.md', 'L1']]);
    expect(session.threads('a.md').threads).toEqual([]);
    session.send(view.rev);
    expect(store.rounds()[0].comments[0]).toMatchObject({ path: 'a.md', side: 'new', start: 1, end: 1, quote: 'one!' });
  });
});

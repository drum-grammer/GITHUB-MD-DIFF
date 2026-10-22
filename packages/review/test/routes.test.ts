import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ThreadsPayload, ViewPayload } from '../src/api-types';
import { appHandlers } from '../src/routes';
import { startServer, type RunningServer } from '../src/server';
import { ReviewSession } from '../src/session';
import { StateStore, stateDirFor } from '../src/state';
import { tempDir, tempRepo, type TempRepo } from './helpers/git-repo';
import { exchange, pageHeaders, request } from './helpers/http';

const repos: TempRepo[] = [];
const servers: RunningServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
  for (const r of repos.splice(0)) r.cleanup();
});
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>';

async function boot(files: Record<string, string>, edits: Record<string, string>) {
  const r = tempRepo();
  repos.push(r);
  for (const [p, t] of Object.entries(files)) r.write(p, t);
  r.commit();
  for (const [p, t] of Object.entries(edits)) r.write(p, t);
  const base = tempDir('mdc-state-');
  const store = new StateStore(base, stateDirFor(base, { root: r.dir, commonDir: join(r.dir, '.git') }), r.dir);
  store.ensure('1.5.1');
  const session = new ReviewSession({ root: r.dir, store, view: 'merge-base' });
  const server = await startServer({ app: appHandlers(session) });
  servers.push(server);
  const secret = await exchange(server.port, server.newCodeUrl());
  const call = async <T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> => {
    const res = await request(server.port, { method, path, body, headers: pageHeaders(server.port, secret) });
    return { status: res.status, data: JSON.parse(res.text) as T };
  };
  return { r, store, server, call };
}

describe('API', () => {
  it('보기 → 초안 더하기·고치기·지우기 → 스레드 → 보내기', async () => {
    const { store, call } = await boot({ '문서/설계 노트.md': '# 설계\n\n처음 글.\n' }, { '문서/설계 노트.md': '# 설계\n\n고친 글.\n' });
    const view = (await call<ViewPayload>('GET', '/api/view')).data;
    expect(view.files.map((f) => f.path)).toEqual(['문서/설계 노트.md']);
    const add = await call<{ id: string }>('POST', '/api/drafts', { rev: view.rev, path: '문서/설계 노트.md', side: 'right', start: 3, end: 3, body: '짧게' });
    expect(add.status).toBe(200);
    expect((await call('PATCH', `/api/drafts/${add.data.id}`, { body: '더 짧게' })).status).toBe(200);
    const threads = (await call<ThreadsPayload>('GET', `/api/threads?path=${encodeURIComponent('문서/설계 노트.md')}`)).data;
    expect(threads.threads[0].comments[0].body).toBe('더 짧게');
    expect((await call<{ drafts: number }>('GET', '/api/summary')).data).toEqual({ drafts: 1 });
    expect((await call('POST', '/api/send', { rev: view.rev })).data).toEqual({ round: 1, comments: 1 });
    expect(store.rounds()[0].comments[0].path).toBe('문서/설계 노트.md');
    const again = await call<{ error: string }>('POST', '/api/send', { rev: view.rev });
    expect(again.status).toBe(400);
    expect(again.data.error).toBe('Add a comment first.');
    const extra = await call<{ id: string }>('POST', '/api/drafts', { rev: view.rev, path: '문서/설계 노트.md', side: 'right', start: 1, end: 1, body: 'x' });
    expect((await call('DELETE', `/api/drafts/${extra.data.id}`)).data).toEqual({ ok: true });
  });
  it('모양이 틀린 본문은 400, 없는 경로는 404, 낡은 판은 409', async () => {
    const { call } = await boot({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    expect((await call('POST', '/api/drafts', { rev: 'r', path: 'a.md' })).status).toBe(400);
    expect((await call('POST', '/api/base', { view: 'sideways' })).status).toBe(400);
    expect((await call('GET', '/api/nope')).status).toBe(404);
    expect((await call('POST', '/api/drafts', { rev: 'rzzzzz', path: 'a.md', side: 'right', start: 1, end: 1, body: 'x' })).status).toBe(409);
  });
  it('미리보기는 로컬 엔진이 그리고 정화한다', async () => {
    const { call } = await boot({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    const html = (await call<{ html: string }>('POST', '/api/preview', { text: '**bold** <script>x()</script>' })).data.html;
    expect(html).toContain('<strong>bold</strong>');
    expect(html).not.toContain('<script');
  });
  it('폴링과 다시 그리기 — 옛 판은 superseded', async () => {
    const { r, call } = await boot({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    const first = (await call<ViewPayload>('GET', '/api/view')).data.rev;
    r.write('a.md', 'b edited\n');
    expect((await call('GET', `/api/poll?rev=${first}`)).data).toEqual({ changed: true, superseded: false });
    const next = (await call<ViewPayload>('POST', '/api/redraw')).data.rev;
    expect((await call('GET', `/api/poll?rev=${first}`)).data).toEqual({ changed: false, superseded: true });
    expect(next).not.toBe(first);
  });
  it('제어 API로 기준을 바꾸면 새 판이 그려지고 새 1회용 주소가 나온다', async () => {
    const { server, call } = await boot({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    const first = (await call<ViewPayload>('GET', '/api/view')).data.rev;
    const res = await request(server.port, { method: 'POST', path: '/control/base', headers: { 'x-mdc-control': server.controlSecret }, body: { view: 'since-last', base: null } });
    expect(JSON.parse(res.text).url).toMatch(/\?code=[0-9a-f]{32}$/);
    expect((await call('GET', `/api/poll?rev=${first}`)).data).toEqual({ changed: false, superseded: true });
    const bad = await request(server.port, { method: 'POST', path: '/control/base', headers: { 'x-mdc-control': server.controlSecret }, body: { view: 'x' } });
    expect(bad.status).toBe(400);
    // 없는 기준은 400(CLI 종료 코드 2), 세션은 앞의 기준 그대로 — 열린 페이지의 다시 그리기가 된다
    const typo = await request(server.port, { method: 'POST', path: '/control/base', headers: { 'x-mdc-control': server.controlSecret }, body: { view: 'merge-base', base: 'nope' } });
    expect(typo.status).toBe(400);
    expect(JSON.parse(typo.text).error).toBe('unknown ref: nope');
    expect((await call('POST', '/api/redraw')).status).toBe(200);
  });
});

describe('/file/<id>', () => {
  it('발급한 이미지만 — SVG는 sandbox CSP·nosniff·attachment, 모르는 id는 404', async () => {
    const { r, call, server } = await boot({ 'docs/a.md': '# A\n' }, {});
    r.write('docs/pic.svg', SVG);
    r.write('docs/a.md', '# A\n\n![pic](pic.svg)\n');
    const html = (await call<ViewPayload>('GET', '/api/view')).data.files[0].html;
    const id = /src="\/file\/([0-9a-f]{32})"/.exec(html)![1];
    const res = await request(server.port, { path: `/file/${id}` });
    expect(res.status).toBe(200);
    expect(res.text).toBe(SVG);
    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect((await request(server.port, { path: `/file/${'0'.repeat(32)}` })).status).toBe(404);
    expect((await request(server.port, { path: '/file/..%2F..%2Fetc%2Fpasswd' })).status).toBe(404);
  });
  it('md가 .GIT·저장소 밖을 가리켜도 id를 내주지 않는다', async () => {
    const { r, call } = await boot({ 'docs/a.md': '# A\n' }, {});
    r.write('docs/a.md', '# A\n\n![x](../.GIT/config)\n\n![y](../../../etc/passwd)\n');
    const html = (await call<ViewPayload>('GET', '/api/view')).data.files[0].html;
    expect(html).not.toMatch(/src="\/file\//);
  });
  it('보내기는 include를 받아도 작업 트리 모드에서 무시하고, 보류 중 리뷰는 작업 트리 모드에서 404', async () => {
    const { call } = await boot({ 'a.md': 'a\n' }, { 'a.md': 'b\n' });
    const view = (await call<ViewPayload>('GET', '/api/view')).data;
    await call('POST', '/api/drafts', { rev: view.rev, path: 'a.md', side: 'right', start: 1, end: 1, body: 'x' });
    expect((await call('POST', '/api/send', { rev: view.rev, include: ['PRRT_x'] })).data).toEqual({ round: 1, comments: 1 });
    expect(await call('POST', '/api/review', { rev: view.rev })).toEqual({ status: 404, data: { error: 'Pending review is only in PR mode.' } });
    expect((await call('POST', '/api/send', { rev: view.rev, include: 'x' })).status).toBe(400);
  });
});

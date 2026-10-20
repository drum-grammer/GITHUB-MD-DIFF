import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewSession } from '../src/session';
import { StateStore, stateDirFor } from '../src/state';
import { tempDir, tempRepo, type TempRepo } from './helpers/git-repo';

const made: TempRepo[] = [];
afterEach(() => {
  for (const r of made.splice(0)) r.cleanup();
});
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function setup(files: Record<string, string | Buffer>): { r: TempRepo; store: StateStore; session: (view?: 'merge-base' | 'since-last') => ReviewSession } {
  const r = tempRepo();
  made.push(r);
  for (const [p, t] of Object.entries(files)) r.write(p, t);
  r.commit('base');
  const base = tempDir('mdc-state-');
  const store = new StateStore(base, stateDirFor(base, { root: r.dir, commonDir: join(r.dir, '.git') }), r.dir);
  store.ensure('1.5.1');
  return { r, store, session: (view = 'merge-base') => new ReviewSession({ root: r.dir, store, view }) };
}

describe('그리기', () => {
  it('바뀐 md마다 엔진 HTML과 새 쪽 원문 — 판에는 모든 md(지운 것은 null)', () => {
    const { r, store, session } = setup({ 'docs/a.md': '# A\n\nOne.\n', 'docs/gone.md': '# Gone\n' });
    r.write('docs/a.md', '# A\n\nTwo.\n');
    r.remove('docs/gone.md');
    const view = session().view();
    expect(view.files.map((f) => `${f.status} ${f.path}`)).toEqual(['modified docs/a.md', 'deleted docs/gone.md']);
    expect(view.files[0].html).toContain('rich-diff-level-zero');
    expect(view.files[0].html).toContain(`data-mdc-rev="${view.rev}"`);
    expect(view.files[0].newText).toBe('# A\n\nTwo.\n');
    expect(view.baseText).toMatch(/^[0-9a-f]{7} \(merge-base main\)$/);
    expect(store.loadRender(view.rev)?.files).toEqual({ 'docs/a.md': '# A\n\nTwo.\n', 'docs/gone.md': null });
  });
  it('HEAD가 기본 브랜치 끝이면 커밋 안 한 변경만 보인다고 알린다', () => {
    const { r, session } = setup({ 'a.md': 'a\n' });
    r.write('a.md', 'b\n');
    expect(session().view().notices).toContainEqual({ key: 'reviewNoticeHeadIsBase' });
  });
  it('그리는 사이 에이전트가 커밋해도(기능 브랜치) 그 변경은 그대로 보인다 — 기준은 분기점', () => {
    const { r, session } = setup({ 'a.md': 'a\n' });
    r.git('checkout', '-q', '-b', 'feature');
    r.write('a.md', 'b\n');
    const s = session();
    expect(s.view().files.map((f) => f.path)).toEqual(['a.md']);
    r.commit('agent edit');
    expect(s.draw().files.map((f) => f.path)).toEqual(['a.md']);
  });
  it('한 파일에서 엔진이 실패해도 다른 파일은 그린다', () => {
    const { r, session } = setup({ 'a.md': 'a\n', 'bin.md': 'x\n' });
    r.write('a.md', 'b\n');
    r.write('bin.md', Buffer.from([0xff, 0xfe, 0x00, 0x41, 0x0a]));
    const files = session().view().files;
    expect(files.find((f) => f.path === 'a.md')!.html).not.toBe('');
    const bin = files.find((f) => f.path === 'bin.md')!;
    expect(bin.html !== '' || bin.error !== undefined).toBe(true);
  });
  it('저장소 상대 이미지는 /file/<id>, 원격 이미지는 막는다(data-mdc-remote)', () => {
    const { r, session } = setup({ 'docs/a.md': '# A\n', 'docs/img/logo.png': PNG });
    r.write('docs/a.md', '# A\n\n![logo](img/logo.png)\n\n![remote](https://example.com/x.png)\n');
    const s = session();
    const html = s.view().files[0].html;
    const id = /src="\/file\/([0-9a-f]{32})"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(s.images.load(id!)).toEqual({ body: PNG, type: 'image/png' });
    expect(html).toContain('data-mdc-remote="https://example.com/x.png"');
    expect(html).not.toContain('src="https://example.com/x.png"');
  });
  it('여러 번 다시 그려도 렌더 판은 최근 20개 + 지금 판만 남는다', () => {
    const { r, store, session } = setup({ 'a.md': 'a\n' });
    r.write('a.md', 'b\n');
    const s = session();
    let rev = '';
    for (let i = 0; i < 25; i++) rev = s.draw().rev;
    expect(readdirSync(store.file('renders')).length).toBeLessThanOrEqual(21);
    expect(store.loadRender(rev)).not.toBeNull();
  });
});

describe('지난 리뷰 이후 · 폴링', () => {
  it('기준 판이 없으면 분기점 보기로 돌아가며 알린다', () => {
    const { r, session } = setup({ 'a.md': 'a\n' });
    r.write('a.md', 'b\n');
    const view = session('since-last').view();
    expect(view.view).toBe('merge-base');
    expect(view.notices).toContainEqual({ key: 'reviewNoticeNoBaseline' });
    expect(view.sinceLastAvailable).toBe(false);
  });
  it('mark한 판 이후 바뀐 파일만 — 기준 글은 "review render <id>"', () => {
    const { r, store, session } = setup({ 'a.md': 'a\n', 'b.md': 'b\n' });
    r.write('a.md', 'a1\n');
    r.write('b.md', 'b1\n');
    const first = session().view().rev;
    store.addMark(first, '2026-10-16T15:00:00+09:00');
    r.write('b.md', 'b2\n');
    const view = session('since-last').view();
    expect(view.view).toBe('since-last');
    expect(view.baseText).toBe(`review render ${first}`);
    expect(view.files.map((f) => f.path)).toEqual(['b.md']);
    expect(view.sinceLastAvailable).toBe(true);
  });
  it('폴링 — 파일이 바뀌면 changed, 새로 그리면 옛 판은 superseded', () => {
    const { r, session } = setup({ 'a.md': 'a\n' });
    r.write('a.md', 'b\n');
    const s = session();
    const rev = s.view().rev;
    expect(s.poll(rev)).toEqual({ changed: false, superseded: false });
    r.write('a.md', 'b, edited by the agent\n');
    expect(s.poll(rev)).toEqual({ changed: true, superseded: false });
    const next = s.draw().rev;
    expect(s.poll(rev)).toEqual({ changed: false, superseded: true });
    expect(s.poll(next)).toEqual({ changed: false, superseded: false });
  });
  it('setView는 기준을 바꿔 새 판을 그린다', () => {
    const { r, session } = setup({ 'a.md': 'a\n' });
    r.git('checkout', '-q', '-b', 'feature');
    r.write('a.md', 'b\n');
    const s = session();
    const first = s.view();
    const again = s.setView('merge-base', 'main');
    expect(again.rev).not.toBe(first.rev);
    expect(again.baseText).toContain('merge-base main');
  });
  it('setView에 없는 기준을 주면 오류를 내고 앞의 기준을 그대로 둔다 — 다시 그리기가 계속 된다', () => {
    const { r, session } = setup({ 'a.md': 'a\n' });
    r.git('checkout', '-q', '-b', 'feature');
    r.write('a.md', 'b\n');
    const s = session();
    const first = s.view();
    expect(() => s.setView('merge-base', 'nope')).toThrow('unknown ref: nope');
    expect(s.draw().baseText).toBe(first.baseText);
  });
  it('기준 판 파일이 지워졌으면(손으로) 그 판 id와 함께 알리고 분기점 보기로 돌아간다', () => {
    const { r, store, session } = setup({ 'a.md': 'a\n' });
    r.write('a.md', 'b\n');
    const rev = session().view().rev;
    store.addMark(rev, '2026-10-16T15:00:00+09:00');
    store.remove(`renders/${rev}.json`);
    const view = session('since-last').view();
    expect(view.view).toBe('merge-base');
    expect(view.notices).toContainEqual({ key: 'reviewNoticeBaselineMissing', subs: [rev] });
    expect(view.notices).not.toContainEqual({ key: 'reviewNoticeNoBaseline' });
  });
});

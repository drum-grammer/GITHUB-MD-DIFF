// CommentController — 요청을 모르는 코멘트 화면 동작. 가짜 백엔드를 붙여 "+"·상자·범위 끌기·스레드 배치·없는 핸들러·연결 재시도·떼기를 본다
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommentController, HOST_ATTR, type CommentBackend, type CommentState } from '../src/comment-controller';
import type { BlockTarget } from '../src/dom-blocks';
import type { PostMode, ReviewComment, ReviewThread } from '../src/types';

const PROSE =
  '<div class="prose-diff"><div><div class="markdown-body">' +
  '<h2 id="h">Title</h2><p id="a" class="changed">first</p><p id="b">second</p><p id="c">third</p>' +
  '</div></div></div>';
/** 블록 id → 원문 줄 */
const LINES: Record<string, BlockTarget> = {
  h: { side: 'right', start: 1, end: 1 },
  a: { side: 'right', start: 3, end: 3 },
  b: { side: 'right', start: 5, end: 5 },
  c: { side: 'right', start: 7, end: 8 },
};

const settle = () => new Promise((r) => setTimeout(r, 0));

function thread(id: string, extra: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id,
    subject: 'line',
    side: 'right',
    start: 5,
    end: 5,
    resolved: false,
    canReply: true,
    comments: [{ id: `${id}-1`, author: 'you', body: `${id} body`, bodyHTML: '', url: '', pending: false, bodyVersion: '', canEdit: true, canDelete: true }],
    ...extra,
  };
}

/** 가짜 백엔드 — 부른 것을 적어 둔다. 선택 동작(reply 등)은 시험에서 붙인다 */
class FakeBackend implements CommentBackend {
  state: CommentState = { threads: [], pendingReview: false };
  loads = 0;
  mappings = 0;
  /** 앞의 이 횟수만큼 mapping이 실패한다 */
  failMappings = 0;
  posted: Array<[BlockTarget, string, PostMode]> = [];
  reply?: CommentBackend['reply'];
  resolve?: CommentBackend['resolve'];
  edit?: CommentBackend['edit'];
  remove?: CommentBackend['remove'];
  preview?: CommentBackend['preview'];
  form?: CommentBackend['form'];
  expectThreads?: boolean;
  unavailable = vi.fn();
  failLoad = false;

  async load(): Promise<CommentState> {
    this.loads++;
    if (this.failLoad) throw new Error('load failed');
    return { threads: [...this.state.threads], pendingReview: this.state.pendingReview };
  }

  async mapping(body: HTMLElement): Promise<Map<HTMLElement, BlockTarget>> {
    this.mappings++;
    if (this.failMappings > 0) {
      this.failMappings--;
      throw new Error('no source text');
    }
    return new Map(Object.entries(LINES).map(([id, tg]) => [body.querySelector<HTMLElement>(`#${id}`)!, tg]));
  }

  suggestion(span: BlockTarget): string | undefined {
    return span.side === 'right' ? `line ${span.start}-${span.end}` : undefined;
  }

  async post(span: BlockTarget, text: string, mode: PostMode): Promise<void> {
    this.posted.push([span, text, mode]);
    this.state = { ...this.state, threads: [...this.state.threads, thread(`new${this.posted.length}`, { start: span.start, end: span.end })] };
  }
}

function setup(backend: FakeBackend): { body: HTMLElement; host: HTMLElement; ctrl: CommentController } {
  document.body.innerHTML = PROSE;
  const body = document.querySelector<HTMLElement>('.markdown-body')!;
  const ctrl = new CommentController(body, backend);
  return { body, host: document.querySelector<HTMLElement>('.prose-diff')!, ctrl };
}

const $ = (body: HTMLElement, id: string) => body.querySelector<HTMLElement>(`#${id}`)!;
const move = (el: Element) => el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
const plus = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-mdf="add-comment"]')!;
const forms = (body: HTMLElement) => [...body.querySelectorAll<HTMLElement>('[data-mdf="comment-form"]')];
const buttons = (root: Element) => [...root.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.textContent);

/** 처음 올리면 줄 연결을 부르고, 연결이 끝난 뒤 다시 올리면 "+"가 그 블록에 나온다 */
async function hover(host: HTMLElement, el: Element): Promise<void> {
  move(el);
  await vi.waitFor(async () => {
    await settle();
    move(el);
    expect(plus(host).hidden).toBe(false);
  });
}

function type(form: HTMLElement, text: string): void {
  const area = form.querySelector('textarea')!;
  area.value = text;
  area.dispatchEvent(new Event('input'));
}

const press = (root: Element, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!.click();

describe('CommentController', () => {
  let ctrl: CommentController | null = null;
  afterEach(() => {
    ctrl?.dispose();
    ctrl = null;
    document.body.innerHTML = '';
  });

  it('붙으면 load를 한 번 부르고, 줄 연결은 처음 마우스를 올릴 때까지 미룬다', async () => {
    const be = new FakeBackend();
    const s = setup(be);
    ctrl = s.ctrl;
    await vi.waitFor(() => expect(be.loads).toBe(1));
    expect(be.mappings).toBe(0);
    expect(s.host.hasAttribute(HOST_ATTR)).toBe(true);
    expect(plus(s.host).hidden).toBe(true);
  });

  it('연결된 블록에 마우스를 올리면 "+"가 나오고, 연결 안 된 곳(만든 상자 안)에서는 안 나온다', async () => {
    const be = new FakeBackend();
    const s = setup(be);
    ctrl = s.ctrl;
    await hover(s.host, $(s.body, 'b'));
    expect(be.mappings).toBe(1);
    s.host.dispatchEvent(new MouseEvent('mouseleave'));
    expect(plus(s.host).hidden).toBe(true);
    const box = document.createElement('div');
    box.setAttribute('data-mdf', 'thread');
    box.innerHTML = '<p>inside a box</p>';
    s.body.append(box);
    move(box.querySelector('p')!);
    expect(plus(s.host).hidden).toBe(true);
  });

  it('"+"를 누르면(키보드) 그 블록 줄의 상자가 열리고, 같은 줄을 다시 누르면 새로 열지 않는다', async () => {
    const be = new FakeBackend();
    const s = setup(be);
    ctrl = s.ctrl;
    await hover(s.host, $(s.body, 'c'));
    plus(s.host).dispatchEvent(new MouseEvent('click', { detail: 0 }));
    const [form] = forms(s.body);
    expect(form.dataset.span).toBe('right:7-8');
    expect(form.querySelector('.mdf-comment-label')!.textContent).toBe('commentOnLines:R7|R8');
    expect($(s.body, 'c').nextElementSibling).toBe(form);
    expect($(s.body, 'c').classList.contains('mdf-selected')).toBe(true);
    move($(s.body, 'c'));
    plus(s.host).dispatchEvent(new MouseEvent('click', { detail: 0 }));
    expect(forms(s.body)).toHaveLength(1);
  });

  it('올리면 backend.post(줄, 글, 모드) 다음 load로 다시 그리고 상자를 닫는다', async () => {
    const be = new FakeBackend();
    const s = setup(be);
    ctrl = s.ctrl;
    await hover(s.host, $(s.body, 'a'));
    plus(s.host).dispatchEvent(new MouseEvent('click', { detail: 0 }));
    const [form] = forms(s.body);
    type(form, 'Please reword');
    press(form, 'commentSingle');
    await vi.waitFor(() => expect(form.isConnected).toBe(false));
    expect(be.posted).toEqual([[{ side: 'right', start: 3, end: 3 }, 'Please reword', 'single']]);
    expect(be.loads).toBe(2);
    const box = s.body.querySelector<HTMLElement>('[data-mdf="thread"]')!;
    expect(box.dataset.threadId).toBe('new1');
    expect($(s.body, 'a').nextElementSibling).toBe(box);
    expect(s.body.querySelectorAll('.mdf-selected')).toHaveLength(0);
  });

  it('올리기가 실패하면 상자에 이유를 보이고 다시 그리지 않는다', async () => {
    const be = new FakeBackend();
    be.post = vi.fn().mockRejectedValue(new Error('errorStale'));
    const s = setup(be);
    ctrl = s.ctrl;
    await hover(s.host, $(s.body, 'a'));
    plus(s.host).dispatchEvent(new MouseEvent('click', { detail: 0 }));
    const [form] = forms(s.body);
    type(form, 'x');
    press(form, 'commentSingle');
    await vi.waitFor(() => expect(form.querySelector<HTMLElement>('.mdf-comment-error')!.hidden).toBe(false));
    expect(form.querySelector('.mdf-comment-error')!.textContent).toBe('errorStale');
    expect(be.loads).toBe(1);
  });

  it('"+"를 누른 채 다른 블록까지 끌면 두 블록을 덮는 범위의 상자가 열린다', async () => {
    const be = new FakeBackend();
    const s = setup(be);
    ctrl = s.ctrl;
    await hover(s.host, $(s.body, 'a'));
    plus(s.host).dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    move($(s.body, 'c'));
    expect(['a', 'b', 'c'].map((id) => $(s.body, id).classList.contains('mdf-selected'))).toEqual([true, true, true]);
    document.dispatchEvent(new MouseEvent('mouseup'));
    const [form] = forms(s.body);
    expect(form.dataset.span).toBe('right:3-8');
    expect($(s.body, 'c').nextElementSibling).toBe(form);
    press(form, 'cancel');
    expect(forms(s.body)).toHaveLength(0);
    expect(s.body.querySelectorAll('.mdf-selected')).toHaveLength(0);
  });

  it('스레드는 줄이 맞는 블록 아래, 맞는 블록이 없으면 "자리를 못 찾은 스레드", 파일 전체는 파일 맨 위', async () => {
    const be = new FakeBackend();
    be.state = {
      threads: [thread('line', { start: 5, end: 5 }), thread('left', { side: 'left', start: 2, end: 2 }), thread('file', { subject: 'file', start: 0, end: 0 })],
      pendingReview: false,
    };
    const s = setup(be);
    ctrl = s.ctrl;
    await vi.waitFor(() => expect(s.body.querySelectorAll('[data-mdf="thread"]')).toHaveLength(3));
    expect(be.mappings).toBe(1);
    expect(($(s.body, 'b').nextElementSibling as HTMLElement).dataset.threadId).toBe('line');
    const [first, second] = [...s.body.children] as HTMLElement[];
    expect(first.getAttribute('data-mdf')).toBe('threads-file');
    expect(first.querySelector<HTMLElement>('[data-mdf="thread"]')!.dataset.threadId).toBe('file');
    expect(second.getAttribute('data-mdf')).toBe('threads-unplaced');
    expect(second.querySelector<HTMLElement>('[data-mdf="thread"]')!.dataset.threadId).toBe('left');
  });

  it('백엔드에 없는 동작의 버튼은 그리지 않고, 있는 동작은 성공한 뒤 다시 그린다', async () => {
    const bare = new FakeBackend();
    bare.state = { threads: [thread('T')], pendingReview: false };
    let s = setup(bare);
    ctrl = s.ctrl;
    await vi.waitFor(() => expect(s.body.querySelector('[data-mdf="thread"]')).not.toBeNull());
    const box = s.body.querySelector<HTMLElement>('[data-mdf="thread"]')!;
    for (const label of ['reply', 'resolve', 'edit', 'delete']) expect(buttons(box)).not.toContain(label);
    ctrl.dispose();

    const full = new FakeBackend();
    full.state = { threads: [thread('T')], pendingReview: false };
    full.reply = vi.fn().mockResolvedValue(undefined);
    full.resolve = vi.fn().mockResolvedValue(undefined);
    full.edit = vi.fn().mockResolvedValue(undefined);
    full.remove = vi.fn().mockResolvedValue(undefined);
    s = setup(full);
    ctrl = s.ctrl;
    await vi.waitFor(() => expect(s.body.querySelector('[data-mdf="thread"]')).not.toBeNull());
    const fullBox = s.body.querySelector<HTMLElement>('[data-mdf="thread"]')!;
    expect(buttons(fullBox)).toEqual(expect.arrayContaining(['reply', 'resolve', 'edit', 'delete']));
    press(fullBox, 'resolve');
    await vi.waitFor(() => expect(full.loads).toBe(2));
    expect(full.resolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'T' }), true);
  });

  it('클래스 메서드로 만든 백엔드 동작도 this를 잃지 않는다(로컬 페이지 백엔드는 클래스다)', async () => {
    class EditingBackend extends FakeBackend {
      edits: string[] = [];
      constructor() {
        super();
        this.edit = EditingBackend.prototype.saveEdit; // 묶지 않은 메서드 그대로 — 컨트롤러가 this를 지켜야 한다
      }
      async saveEdit(this: EditingBackend, c: ReviewComment, text: string): Promise<void> {
        this.edits.push(`${c.id}:${text}`);
      }
    }
    const be = new EditingBackend();
    be.state = { threads: [thread('T')], pendingReview: false };
    const s = setup(be);
    ctrl = s.ctrl;
    await vi.waitFor(() => expect(s.body.querySelector('[data-mdf="thread"]')).not.toBeNull());
    const box = s.body.querySelector<HTMLElement>('[data-mdf="thread"]')!;
    press(box, 'edit');
    box.querySelector<HTMLTextAreaElement>('.mdf-comment-edit textarea')!.value = 'fixed';
    press(box.querySelector('.mdf-comment-edit')!, 'save');
    await vi.waitFor(() => expect(be.edits).toEqual(['T-1:fixed']));
    expect(be.loads).toBe(2);
  });

  it('답글은 backend.reply(스레드, 글, 모드) 다음 다시 그린다 — 쓰던 답글은 다시 그려도 남는다', async () => {
    const be = new FakeBackend();
    be.state = { threads: [thread('T'), thread('U', { start: 7, end: 8 })], pendingReview: false };
    be.reply = vi.fn().mockResolvedValue(undefined);
    const s = setup(be);
    ctrl = s.ctrl;
    await vi.waitFor(() => expect(s.body.querySelectorAll('[data-mdf="thread"]')).toHaveLength(2));
    const [tBox, uBox] = [...s.body.querySelectorAll<HTMLElement>('[data-mdf="thread"]')];
    press(uBox, 'reply');
    type(uBox.querySelector<HTMLElement>('.mdf-comment-form')!, 'half-written');
    press(tBox, 'reply');
    const tForm = tBox.querySelector<HTMLElement>('.mdf-comment-form')!;
    type(tForm, 'Done');
    press(tForm, 'reply');
    await vi.waitFor(() => expect(be.loads).toBe(2));
    expect(be.reply).toHaveBeenCalledWith(expect.objectContaining({ id: 'T' }), 'Done', 'single');
    const redrawnU = [...s.body.querySelectorAll<HTMLElement>('[data-mdf="thread"]')].find((b) => b.dataset.threadId === 'U')!;
    expect(redrawnU.querySelector('textarea')!.value).toBe('half-written');
  });

  it('상자 모양(form)·보류 중 리뷰·제안 줄은 백엔드가 정한다', async () => {
    const be = new FakeBackend();
    be.form = { buttons: 'local', showAvatar: false, singleLabel: 'Add comment' };
    const s = setup(be);
    ctrl = s.ctrl;
    await hover(s.host, $(s.body, 'b'));
    plus(s.host).dispatchEvent(new MouseEvent('click', { detail: 0 }));
    const [form] = forms(s.body);
    expect([...form.querySelectorAll('.mdf-comment-actions > button')].map((b) => b.textContent)).toEqual(['cancel', 'Add comment']);
    press(form, 'cancel');

    const gh = new FakeBackend();
    gh.state = { threads: [], pendingReview: true };
    ctrl.dispose();
    const s2 = setup(gh);
    ctrl = s2.ctrl;
    await vi.waitFor(() => expect(gh.loads).toBe(1));
    await hover(s2.host, $(s2.body, 'b'));
    plus(s2.host).dispatchEvent(new MouseEvent('click', { detail: 0 }));
    const [ghForm] = forms(s2.body);
    expect([...ghForm.querySelectorAll('.mdf-comment-actions > button')].map((b) => b.textContent)).toEqual(['cancel', 'commentReviewAdd']);
    ghForm.querySelector<HTMLButtonElement>('[aria-label="fmtSuggestion"]')!.click();
    expect(ghForm.querySelector('textarea')!.value).toBe('```suggestion\nline 5-5\n```');
  });

  it('줄 연결이 실패하면 "+" 없이 두고, 다음에 마우스를 올릴 때 다시 부른다', async () => {
    const be = new FakeBackend();
    be.failMappings = 1;
    const s = setup(be);
    ctrl = s.ctrl;
    move($(s.body, 'a'));
    await vi.waitFor(() => expect(be.mappings).toBe(1));
    await settle();
    move($(s.body, 'a'));
    await settle();
    expect(plus(s.host).hidden).toBe(true);
    await hover(s.host, $(s.body, 'a'));
    expect(be.mappings).toBe(2);
  });

  it('스레드가 있어야 하는 파일인데 load가 실패하거나 스레드가 없으면 unavailable을 부른다', async () => {
    const failing = new FakeBackend();
    failing.expectThreads = true;
    failing.failLoad = true;
    ctrl = setup(failing).ctrl;
    await vi.waitFor(() => expect(failing.unavailable).toHaveBeenCalledTimes(1));
    ctrl.dispose();

    const empty = new FakeBackend();
    empty.expectThreads = true;
    ctrl = setup(empty).ctrl;
    await vi.waitFor(() => expect(empty.unavailable).toHaveBeenCalledTimes(1));
    ctrl.dispose();

    const quiet = new FakeBackend();
    ctrl = setup(quiet).ctrl;
    await vi.waitFor(() => expect(quiet.loads).toBe(1));
    expect(quiet.unavailable).not.toHaveBeenCalled();
  });

  it('dispose — "+"·표시·음영을 걷고, 이벤트를 떼어 마우스를 올려도 연결하지 않으며 끌던 범위도 열지 않는다', async () => {
    const be = new FakeBackend();
    const s = setup(be);
    ctrl = s.ctrl;
    await hover(s.host, $(s.body, 'a'));
    plus(s.host).dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    ctrl.dispose();
    document.dispatchEvent(new MouseEvent('mouseup'));
    expect(forms(s.body)).toHaveLength(0);
    expect(s.host.querySelector('[data-mdf="add-comment"]')).toBeNull();
    expect(s.host.hasAttribute(HOST_ATTR)).toBe(false);
    expect(s.body.querySelectorAll('.mdf-selected')).toHaveLength(0);
    const before = be.mappings;
    move($(s.body, 'b'));
    await settle();
    expect(be.mappings).toBe(before);
    expect(ctrl.alive()).toBe(false);
  });

  it('alive — 본문 안을 통째로 다시 그려 연결한 블록이 사라지면 false', async () => {
    const be = new FakeBackend();
    const s = setup(be);
    ctrl = s.ctrl;
    expect(ctrl.alive()).toBe(true);
    await hover(s.host, $(s.body, 'a'));
    expect(ctrl.alive()).toBe(true);
    s.body.innerHTML = '<p id="a">first</p>';
    expect(ctrl.alive()).toBe(false);
  });
});

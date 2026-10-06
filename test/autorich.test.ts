import { describe, expect, it } from 'vitest';
import { createAutoRichState, ensureRich, watchUserViewClicks } from '../src/autorich';
import { viewButton } from '../src/selectors';
import { addProse, fakeFile } from './helpers';

function countClicks(btn: HTMLElement): () => number {
  let n = 0;
  btn.addEventListener('click', () => n++);
  return () => n;
}

/** GitHub처럼 누르면 눌림 상태가 되게 한다 */
function pressOnClick(btn: HTMLElement): void {
  btn.addEventListener('click', () => btn.setAttribute('aria-pressed', 'true'));
}

describe('ensureRich', () => {
  it('렌더링 버튼을 한 번만 누르고(눌림이 반영되면), 5초가 지나면 timeout', () => {
    const file = fakeFile();
    const state = createAutoRichState();
    pressOnClick(viewButton(file, 'rich')!);
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', state, 0)).toBe('clicked');
    expect(ensureRich(file, 'k', state, 1000)).toBe('waiting');
    expect(ensureRich(file, 'k', state, 5001)).toBe('timeout');
    expect(ensureRich(file, 'k', state, 9000)).toBe('timeout');
    expect(clicks()).toBe(1);
  });

  it('눌렀는데 눌림이 반영되지 않으면(페이지가 아직 준비 전) 1초 간격으로 최대 3번 누른다', () => {
    const file = fakeFile();
    const state = createAutoRichState();
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', state, 0)).toBe('clicked');
    expect(ensureRich(file, 'k', state, 500)).toBe('waiting');
    expect(ensureRich(file, 'k', state, 1001)).toBe('clicked');
    expect(ensureRich(file, 'k', state, 2002)).toBe('clicked');
    expect(ensureRich(file, 'k', state, 3003)).toBe('waiting');
    expect(ensureRich(file, 'k', state, 5001)).toBe('timeout');
    expect(clicks()).toBe(3);
  });

  it('렌더링이 이미 있으면 누르지 않는다', () => {
    const file = fakeFile();
    addProse(file);
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('rich');
    expect(clicks()).toBe(0);
  });

  it('렌더링이 나타난 뒤 원문으로 되돌아가면(다시 그리기) 다시 한 번 누른다', () => {
    const file = fakeFile();
    const state = createAutoRichState();
    const clicks = countClicks(viewButton(file, 'rich')!);
    ensureRich(file, 'k', state, 0);
    addProse(file);
    expect(ensureRich(file, 'k', state, 100)).toBe('rich');
    file.querySelector('.diff-body')!.replaceChildren();
    expect(ensureRich(file, 'k', state, 200)).toBe('clicked');
    expect(clicks()).toBe(2);
  });

  it('버튼이 아직 없으면 pending, 5초 넘게 없으면 no-button', () => {
    const file = fakeFile();
    file.querySelectorAll('button').forEach((b) => b.remove());
    const state = createAutoRichState();
    expect(ensureRich(file, 'k', state, 0)).toBe('pending');
    expect(ensureRich(file, 'k', state, 3000)).toBe('pending');
    expect(ensureRich(file, 'k', state, 5001)).toBe('no-button');
  });

  it('버튼이 나중에 그려지면 문제없이 누른다', () => {
    const state = createAutoRichState();
    const early = fakeFile();
    early.querySelectorAll('button').forEach((b) => b.remove());
    expect(ensureRich(early, 'k', state, 0)).toBe('pending');
    const file = fakeFile(); // 다시 그려짐
    expect(ensureRich(file, 'k', state, 6000)).toBe('clicked');
  });

  it('접힌 파일(Viewed·접기)은 건드리지 않는다', () => {
    const file = fakeFile();
    const header = file.querySelector('[class*="DiffFileHeader-module__diff-file-header"]')!;
    header.insertAdjacentHTML('afterbegin', '<button type="button" aria-labelledby="l-exp"></button><span id="l-exp">Expand file</span>');
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('idle');
    expect(clicks()).toBe(0);
  });

  it('렌더링 버튼이 이미 눌려 있으면(본문만 내려간 상태) 누르지 않는다', () => {
    const file = fakeFile();
    const rich = viewButton(file, 'rich')!;
    rich.setAttribute('aria-pressed', 'true');
    const clicks = countClicks(rich);
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('idle');
    expect(clicks()).toBe(0);
  });

  it('줄 코멘트 스레드가 있는 파일은 원문 그대로 둔다 — 렌더링 보기는 스레드를 보여 주지 않는다', () => {
    const file = fakeFile();
    file.querySelector('.diff-body')!.insertAdjacentHTML(
      'beforeend',
      '<div class="InlineReviewThread-module__ReviewThreadContainer__iFcNZ">코멘트</div>',
    );
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('has-threads');
    expect(clicks()).toBe(0);
  });

  it('툴팁 라벨이 없어도 아이콘으로 찾아 누른다', () => {
    const file = fakeFile('a.md', false);
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('clicked');
  });
});

describe('watchUserViewClicks', () => {
  it('사람이 원문을 누른 파일은 건드리지 않고, 다시 렌더링을 누르면 맡는다', () => {
    const file = fakeFile();
    const state = createAutoRichState();
    const stop = watchUserViewClicks(document, state, () => 'k');
    viewButton(file, 'source')!.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ensureRich(file, 'k', state, 0)).toBe('user-source');
    viewButton(file, 'rich')!.click();
    expect(state.userSource.has('k')).toBe(false);
    stop();
  });

  it('끝낸 뒤에는 기억하지 않는다', () => {
    const file = fakeFile();
    const state = createAutoRichState();
    watchUserViewClicks(document, state, () => 'k')();
    viewButton(file, 'source')!.click();
    expect(state.userSource.size).toBe(0);
  });
});

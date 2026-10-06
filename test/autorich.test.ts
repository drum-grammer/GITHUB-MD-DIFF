import { describe, expect, it } from 'vitest';
import { createAutoRichState, ensureRich, watchUserViewClicks } from '../src/autorich';
import { viewButton } from '../src/selectors';
import { addProse, fakeFile } from './helpers';

function countClicks(btn: HTMLElement): () => number {
  let n = 0;
  btn.addEventListener('click', () => n++);
  return () => n;
}

describe('ensureRich', () => {
  it('렌더링 버튼을 한 번만 누르고, 5초가 지나면 timeout', () => {
    const file = fakeFile();
    const state = createAutoRichState();
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', state, 0)).toBe('clicked');
    expect(ensureRich(file, 'k', state, 1000)).toBe('waiting');
    expect(ensureRich(file, 'k', state, 5001)).toBe('timeout');
    expect(ensureRich(file, 'k', state, 9000)).toBe('timeout');
    expect(clicks()).toBe(1);
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

  it('버튼이 없으면 no-button', () => {
    const file = fakeFile();
    file.querySelectorAll('button').forEach((b) => b.remove());
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('no-button');
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

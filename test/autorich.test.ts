import { describe, expect, it } from 'vitest';
import { createAutoRichState, ensureRich, watchUserViewClicks } from '../src/autorich';
import { viewButton } from '../src/selectors';
import { addProse, fakeClassicFile, fakeFile } from './helpers';

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
  it('렌더링 버튼을 한 번만 누르고(눌림이 반영되면), 렌더링이 모르는 모양으로 나오면 5초 뒤 timeout', () => {
    const file = fakeFile();
    const state = createAutoRichState();
    pressOnClick(viewButton(file, 'rich')!);
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', state, 0)).toBe('clicked');
    expect(ensureRich(file, 'k', state, 1000)).toBe('waiting');
    file.querySelector('.diff-body')!.innerHTML = '<div class="new-rich-view"><h2>제목</h2><p>글</p></div>';
    expect(ensureRich(file, 'k', state, 5001)).toBe('timeout');
    expect(ensureRich(file, 'k', state, 20000)).toBe('timeout');
    expect(clicks()).toBe(1);
  });

  it('렌더링이 안 오고 상자가 비어 있으면(GitHub 504 등) 기다렸다가 원문 보기로 되돌리고, 다시 누르지 않는다', () => {
    const file = fakeFile();
    const rich = viewButton(file, 'rich')!;
    const source = viewButton(file, 'source')!;
    pressOnClick(rich);
    source.addEventListener('click', () => {
      source.setAttribute('aria-pressed', 'true');
      rich.setAttribute('aria-pressed', 'false');
    });
    const richClicks = countClicks(rich);
    const sourceClicks = countClicks(source);
    const state = createAutoRichState();
    const stop = watchUserViewClicks(document, state, () => 'k');
    expect(ensureRich(file, 'k', state, 0)).toBe('clicked');
    rich.setAttribute('aria-pressed', 'true');
    source.setAttribute('aria-pressed', 'false');
    file.querySelector('.diff-body')!.innerHTML = '<div class="d-flex"><svg class="spinner"></svg><span class="sr-only">Loading</span></div>';
    expect(ensureRich(file, 'k', state, 5001)).toBe('waiting');
    file.querySelector('.diff-body')!.innerHTML = '<div class="d-flex"></div>';
    expect(ensureRich(file, 'k', state, 14000)).toBe('waiting');
    expect(ensureRich(file, 'k', state, 15001)).toBe('fallback');
    expect(sourceClicks()).toBe(1);
    expect(state.userSource.has('k')).toBe(false); // 확장이 누른 원문 클릭은 사람의 선택이 아니다
    expect(ensureRich(file, 'k', state, 20000)).toBe('fallback');
    expect(richClicks()).toBe(1);
    expect(sourceClicks()).toBe(1);
    stop();
  });

  it('되돌린 뒤 사람이 렌더링을 누르면 늦게 나와도 되돌리지 않는다', () => {
    const file = fakeFile();
    const rich = viewButton(file, 'rich')!;
    const state = createAutoRichState();
    const stop = watchUserViewClicks(document, state, () => 'k');
    ensureRich(file, 'k', state, 0);
    expect(ensureRich(file, 'k', state, 15001)).toBe('fallback');
    rich.click();
    rich.setAttribute('aria-pressed', 'true');
    expect(ensureRich(file, 'k', state, 16000)).toBe('idle');
    expect(ensureRich(file, 'k', state, 60000)).toBe('idle');
    stop();
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
    expect(ensureRich(file, 'k', state, 5001)).toBe('waiting');
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

  it('파일 내용이 아직 뼈대면(큰 PR의 아래쪽 파일) 버튼이 없어도 no-button으로 세지 않는다', () => {
    const file = fakeFile();
    file.querySelectorAll('button').forEach((b) => b.remove());
    file.querySelector('.diff-body')!.innerHTML = '<div class="LoadingSkeleton-module__skeleton__euqGn"></div>';
    const state = createAutoRichState();
    expect(ensureRich(file, 'k', state, 0)).toBe('lazy');
    expect(ensureRich(file, 'k', state, 60_000)).toBe('lazy');
  });

  it('원문 보기가 줄 대신 안내 글이면(이름만 바뀜·Load Diff) 렌더링을 누르지 않는다', () => {
    const file = fakeFile();
    file.querySelector('.diff-body')!.innerHTML = '<div class="fgColor-muted p-2" data-diff-anchor="diff-abc">File renamed without changes.</div>';
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('notice');
    expect(clicks()).toBe(0);
  });

  it('원문 diff 표(data-diff-anchor가 table)는 평소처럼 누른다', () => {
    const file = fakeFile();
    file.querySelector('.diff-body')!.innerHTML = '<table data-diff-anchor="diff-abc"><tr><td>+ 줄</td></tr></table>';
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('clicked');
  });

  it('렌더링을 기다리는 파일이 6개면 7번째는 차례를 기다리고, 하나가 렌더링되면 누른다', () => {
    const state = createAutoRichState();
    for (let i = 0; i < 6; i++) {
      fakeFile();
      expect(ensureRich(document.querySelector<HTMLElement>('#diff-abc')!, `k${i}`, state, 0)).toBe('clicked');
    }
    const file = fakeFile();
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k6', state, 100)).toBe('queued');
    expect(clicks()).toBe(0);
    const done = fakeFile();
    addProse(done);
    expect(ensureRich(done, 'k0', state, 200)).toBe('rich');
    const again = fakeFile();
    expect(ensureRich(again, 'k6', state, 300)).toBe('clicked');
  });

  it('되돌릴 때가 지난 기록은 차례를 막지 않는다', () => {
    const state = createAutoRichState();
    for (let i = 0; i < 6; i++) ensureRich(fakeFile(), `k${i}`, state, 0);
    expect(ensureRich(fakeFile(), 'k6', state, 16_000)).toBe('clicked');
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

  it('줄 코멘트 스레드가 있는 파일은 원문 그대로 둔다 — 로그아웃이면 렌더링 보기에 스레드를 보여 줄 수 없다', () => {
    const file = fakeFile();
    file.querySelector('.diff-body')!.insertAdjacentHTML(
      'beforeend',
      '<div class="InlineReviewThread-module__ReviewThreadContainer__iFcNZ">코멘트</div>',
    );
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('has-threads');
    expect(clicks()).toBe(0);
  });

  it('로그인하면(threadsInRich) 스레드가 있어도 렌더링으로 바꾸고 기억해 둔다', () => {
    const file = fakeFile();
    file.querySelector('.diff-body')!.insertAdjacentHTML(
      'beforeend',
      '<div class="InlineReviewThread-module__ReviewThreadContainer__iFcNZ">코멘트</div>',
    );
    const state = createAutoRichState();
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', state, 0, true)).toBe('clicked');
    expect(clicks()).toBe(1);
    expect(state.hadThreads.has('k')).toBe(true);
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

  it('확장이 누른 렌더링 클릭은 기록을 지우지 않는다(다시 누르기·시간 판정 유지)', () => {
    const file = fakeFile();
    const state = createAutoRichState();
    const stop = watchUserViewClicks(document, state, () => 'k');
    expect(ensureRich(file, 'k', state, 0)).toBe('clicked');
    expect(state.clicks.has('k')).toBe(true);
    expect(ensureRich(file, 'k', state, 1001)).toBe('clicked'); // 눌림이 반영되지 않아 다시
    expect(state.clicks.get('k')?.count).toBe(2);
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

describe('ensureRich — 옛 화면', () => {
  it('렌더링 버튼을 눌러 selected가 되면 다시 누르지 않는다', () => {
    const file = fakeClassicFile();
    const rich = viewButton(file, 'rich')!;
    rich.addEventListener('click', () => rich.classList.add('selected'));
    const clicks = countClicks(rich);
    const state = createAutoRichState();
    expect(ensureRich(file, 'k', state, 0)).toBe('clicked');
    expect(ensureRich(file, 'k', state, 1500)).toBe('waiting');
    expect(clicks()).toBe(1);
  });

  it('렌더링 보기가 이미 골라져 있으면(selected) 누르지 않는다', () => {
    const file = fakeClassicFile();
    viewButton(file, 'rich')!.classList.add('selected');
    const clicks = countClicks(viewButton(file, 'rich')!);
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('idle');
    expect(clicks()).toBe(0);
  });

  it('렌더링 본문이 나타나면 rich', () => {
    const file = fakeClassicFile();
    addProse(file);
    expect(ensureRich(file, 'k', createAutoRichState(), 0)).toBe('rich');
  });
});

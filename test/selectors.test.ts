import { describe, expect, it } from 'vitest';
import {
  fileElements, fileOf, filePath, hasReviewThreads, hasUnknownRendering, headerBlock, isCollapsed, isFoldable, isLargeDiffPlaceholder, isMarkdownPath, isPressed, loadDiffButton, pageStructure, pageVariant,
  proseBody, setHidden, showsRichFailure, tablePairs, viewButton,
} from '../src/selectors';
import { FILE_FORMATS, addProse, fakeClassicFile, fakeFile, loadFixture } from './helpers';

describe('파일 묶음', () => {
  it('파일 묶음을 찾고 경로에서 방향 표시 문자를 뗀다', () => {
    fakeFile('docs/가이드.md');
    const [file] = fileElements(document);
    expect(filePath(file)).toBe('docs/가이드.md');
  });

  it.each([
    ['a.md', true], ['A.MARKDOWN', true], ['b/c.mdx', true],
    ['a.txt', false], ['md', false], ['old.txt → new.md', true],
  ])('isMarkdownPath(%s) = %s', (path, want) => {
    expect(isMarkdownPath(path)).toBe(want);
  });

  it('렌더링·원문 버튼을 툴팁 라벨로 찾는다', () => {
    const file = fakeFile();
    expect(viewButton(file, 'rich')?.getAttribute('aria-labelledby')).toBe('l-rich');
    expect(viewButton(file, 'source')?.getAttribute('aria-labelledby')).toBe('l-src');
  });

  it('라벨이 없으면 아이콘으로 찾는다', () => {
    const file = fakeFile('a.md', false);
    expect(viewButton(file, 'rich')?.querySelector('svg.octicon-file')).not.toBeNull();
    expect(viewButton(file, 'source')?.querySelector('svg.octicon-code')).not.toBeNull();
  });

  it('버튼 안 아이콘에서 파일 묶음을 거슬러 찾는다', () => {
    const file = fakeFile();
    const icon = viewButton(file, 'rich')!.querySelector('svg')!;
    expect(fileOf(icon)).toBe(file);
  });

  it('렌더링 본문은 렌더링이 나타난 뒤에만 있다', () => {
    const file = fakeFile();
    expect(proseBody(file)).toBeNull();
    const body = addProse(file);
    expect(proseBody(file)).toBe(body);
  });
});

describe('setHidden', () => {
  it('숨김을 풀 때 비게 된 class 속성은 지운다', () => {
    document.body.innerHTML = '<del>x</del><p class="a">y</p>';
    const del = document.querySelector('del')!;
    const p = document.querySelector('p')!;
    setHidden(del, true);
    setHidden(p, true);
    expect(del.getAttribute('class')).toBe('mdf-hidden');
    setHidden(del, false);
    setHidden(p, false);
    expect(del.hasAttribute('class')).toBe(false);
    expect(p.getAttribute('class')).toBe('a');
  });
});

describe('tablePairs — 표만 든 블록', () => {
  const table = '<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>';
  it('표를 품은 목록은 쌍으로 받지 않는다 — 목록 글이 숨겨지면 안 된다', () => {
    document.body.innerHTML = `<div class="markdown-body"><del><ul><li>글</li><li>${table}</li></ul></del><ins><ul><li>글2</li><li>${table}</li></ul></ins></div>`;
    expect(tablePairs(document.querySelector('.markdown-body')!)).toHaveLength(0);
  });
  it('표 옆에 글이 있으면 받지 않는다', () => {
    document.body.innerHTML = `<div class="markdown-body"><del>설명 ${table}</del><ins>설명 ${table}</ins></div>`;
    expect(tablePairs(document.querySelector('.markdown-body')!)).toHaveLength(0);
  });
  it('감싼 요소 하나 + 공백뿐이면 받는다', () => {
    document.body.innerHTML = `<div class="markdown-body"><del> <x-t>${table}</x-t> </del><ins><x-t>${table}</x-t></ins></div>`;
    expect(tablePairs(document.querySelector('.markdown-body')!)).toHaveLength(1);
  });
});

describe('렌더링 본문', () => {
  it('고정 자료: 변경 없는 묶음 3개, 표 쌍 1개', () => {
    const body = loadFixture('handmade-prose.html');
    expect([...body.children].filter(isFoldable)).toHaveLength(3);
    const pairs = tablePairs(body);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].oldTable.tBodies[0].rows).toHaveLength(4);
    expect(pairs[0].newTable.tBodies[0].rows).toHaveLength(5);
  });
});

describe('옛 화면(로그아웃)', () => {
  it('파일 묶음을 찾고 경로는 data-path에서 읽는다', () => {
    fakeClassicFile('docs/설계.md');
    const [file] = fileElements(document);
    expect(file?.id).toBe('diff-abc');
    expect(filePath(file)).toBe('docs/설계.md');
  });

  it('렌더링·원문 버튼을 aria-label로 찾고, 눌린 상태는 selected 클래스로 본다', () => {
    const file = fakeClassicFile();
    expect(viewButton(file, 'rich')?.classList.contains('js-rendered')).toBe(true);
    expect(isPressed(viewButton(file, 'source')!)).toBe(true);
    expect(isPressed(viewButton(file, 'rich')!)).toBe(false);
  });

  it('접힌 파일: 접기 버튼이 aria-expanded=false', () => {
    const file = fakeClassicFile();
    expect(isCollapsed(file)).toBe(false);
    file.querySelector('button[aria-label="Toggle diff contents"]')!.setAttribute('aria-expanded', 'false');
    expect(isCollapsed(file)).toBe(true);
  });

  it('줄 코멘트 스레드: tr.inline-comments', () => {
    const file = fakeClassicFile();
    expect(hasReviewThreads(file)).toBe(false);
    file.querySelector('.diff-body')!.insertAdjacentHTML('beforeend', '<table><tr class="inline-comments"><td>코멘트</td></tr></table>');
    expect(hasReviewThreads(file)).toBe(true);
  });

  it('새 화면 버튼은 aria-pressed로 눌린 상태를 본다', () => {
    const file = fakeFile();
    expect(isPressed(viewButton(file, 'source')!)).toBe(true);
    expect(isPressed(viewButton(file, 'rich')!)).toBe(false);
  });
});

describe('hasUnknownRendering', () => {
  it('빈 상자·불러오기 표시·원문 diff 표는 렌더링이 아니다', () => {
    const file = fakeFile();
    const body = file.querySelector('.diff-body')!;
    expect(hasUnknownRendering(file)).toBe(false);
    body.innerHTML = '<div><svg class="spinner"></svg><span class="sr-only">Loading</span></div>';
    expect(hasUnknownRendering(file)).toBe(false);
    body.innerHTML = '<table><tr><td class="blob-code">+ 줄</td></tr></table>';
    expect(hasUnknownRendering(file)).toBe(false);
  });

  it('머리의 파일 이름(h3)은 세지 않고, 렌더링된 글이 .prose-diff 밖에 있으면 모르는 모양', () => {
    const file = fakeFile();
    expect(file.querySelector('h3')).not.toBeNull();
    file.querySelector('.diff-body')!.innerHTML = '<article class="markdown-body-v2"><p>글</p></article>';
    expect(hasUnknownRendering(file)).toBe(true);
  });

  it('.prose-diff가 있으면 아는 모양', () => {
    const file = fakeFile();
    addProse(file);
    expect(hasUnknownRendering(file)).toBe(false);
  });
});

describe('렌더링 실패 안내 · Load Diff', () => {
  const FAILED = '<div class="border"><div class="d-flex flex-justify-center tmp-p-4">This rich diff is not supported at the moment.</div></div>';

  it('GitHub의 렌더링 실패 안내를 알아본다', () => {
    const file = fakeFile();
    expect(showsRichFailure(file)).toBe(false);
    file.querySelector('.diff-body')!.innerHTML = FAILED;
    expect(showsRichFailure(file)).toBe(true);
  });

  it('원문 표 칸·확장 상자 안의 같은 문장, 렌더링 본문이 있는 파일은 실패가 아니다', () => {
    const file = fakeFile();
    const body = file.querySelector('.diff-body')!;
    body.innerHTML = '<table data-diff-anchor="diff-abc"><tr><td><span>This rich diff is not supported at the moment.</span></td></tr></table>';
    expect(showsRichFailure(file)).toBe(false);
    body.innerHTML = '<div data-mdf="comment-notice"><span>This rich diff is not supported at the moment.</span></div>';
    expect(showsRichFailure(file)).toBe(false);
    addProse(file).innerHTML = '<p>This rich diff is not supported at the moment.</p>';
    expect(showsRichFailure(file)).toBe(false);
  });

  it.each(FILE_FORMATS)('Load Diff 버튼과 파일 머리 칸(%s)', (format) => {
    const file = fakeFile('docs/a.md', true, format);
    expect(loadDiffButton(file)).toBeNull();
    file.querySelector('.diff-body')!.innerHTML = '<div data-diff-anchor="diff-abc"><div><button>Load Diff</button></div></div>';
    expect(loadDiffButton(file)?.textContent).toBe('Load Diff');
    expect(isLargeDiffPlaceholder(file)).toBe(true);
    const top = headerBlock(file)!;
    expect(top.parentElement).toBe(file);
    expect(top.querySelector('h3')).not.toBeNull();
  });
});

describe('filePath — 이름이 바뀐 파일', () => {
  it('화면 낭독기용 "옛 경로 renamed to 새 경로"에서 새 경로를 쓴다(보이는 쪽은 줄여 쓴다)', () => {
    const file = fakeFile();
    file.querySelector('h3 code')!.innerHTML =
      '<span aria-hidden="true">\u200electure/2nd/docker-cli-example.md\u200e <svg class="octicon octicon-arrow-right"></svg> \u200e…e/2nd/test_example/docker-cli-example.md\u200e</span>' +
      '<span class="sr-only">lecture/2nd/docker-cli-example.md renamed to lecture/2nd/test_example/docker-cli-example.md</span>';
    expect(filePath(file)).toBe('lecture/2nd/test_example/docker-cli-example.md');
  });

  it('공백이 든 경로는 그대로', () => {
    const file = fakeFile('docs/api 기능 정의서 초안.md');
    expect(filePath(file)).toBe('docs/api 기능 정의서 초안.md');
    expect(isMarkdownPath(filePath(file)!)).toBe(true);
  });
});

/**
 * GitHub가 클래스 이름 형식을 바꿔도(2026-10-14 `Diff-module__diff__해시` → `diff__해시`, 1.5.0이 로그인 화면에서 멈춘 원인)
 * 되돌려도, 또 다른 형식으로 바꿔도 파일을 찾는다 — 파일 앵커 id(`diff-<해시>`, PR 파일 링크 주소)와 구조가 1순위다
 */
describe.each(FILE_FORMATS)('새 화면 클래스 형식 %s', (format) => {
  it('파일 묶음 하나만 찾는다 — id가 diff-로 시작하는 큰 상자는 파일이 아니다', () => {
    const file = fakeFile('docs/가이드.md', true, format);
    expect(fileElements(document)).toEqual([file]);
    expect(filePath(file)).toBe('docs/가이드.md');
    expect(pageVariant(document)).toBe('new');
  });

  it('렌더링·원문 버튼을 라벨로, 라벨이 없으면 아이콘으로 찾는다', () => {
    const file = fakeFile('a.md', true, format);
    expect(viewButton(file, 'rich')?.getAttribute('aria-labelledby')).toBe('l-rich');
    expect(viewButton(file, 'source')?.getAttribute('aria-labelledby')).toBe('l-src');
    const bare = fakeFile('a.md', false, format);
    expect(viewButton(bare, 'rich')?.querySelector('svg.octicon-file')).not.toBeNull();
  });

  it('안쪽 요소에서 파일 묶음을 거슬러 찾는다(큰 상자가 아니라 파일)', () => {
    const file = fakeFile('a.md', true, format);
    expect(fileOf(viewButton(file, 'rich')!.querySelector('svg')!)).toBe(file);
    expect(fileOf(addProse(file))).toBe(file);
  });

  it('접힌 파일: 머리에 "Expand file" 버튼', () => {
    const file = fakeFile('a.md', true, format);
    expect(isCollapsed(file)).toBe(false);
    file.querySelector('h3')!.insertAdjacentHTML('beforebegin', '<button type="button" aria-label="Expand file"></button>');
    expect(isCollapsed(file)).toBe(true);
  });

  it('머리의 파일 이름(h3)은 렌더링된 글로 세지 않는다', () => {
    const file = fakeFile('a.md', true, format);
    expect(hasUnknownRendering(file)).toBe(false);
    file.querySelector('.diff-body')!.innerHTML = '<article class="markdown-body-v2"><p>글</p></article>';
    expect(hasUnknownRendering(file)).toBe(true);
  });

  it('렌더링 본문 안의 h3 code는 파일 이름이 아니다', () => {
    const file = fakeFile('docs/a.md', true, format);
    addProse(file).innerHTML = '<h3><code>not-a-path.md</code></h3>';
    expect(filePath(file)).toBe('docs/a.md');
  });

  it('이름이 바뀐 파일은 화면 낭독기용 글에서 새 경로를 쓴다', () => {
    const file = fakeFile('a.md', true, format);
    file.querySelector('h3 code')!.innerHTML =
      '<span aria-hidden="true">docs/moved.md <svg class="octicon octicon-arrow-right"></svg> docs/archive/moved.md</span>' +
      '<span class="sr-only">docs/moved.md<!-- --> renamed to <!-- -->docs/archive/moved.md<!-- --> </span>';
    expect(filePath(file)).toBe('docs/archive/moved.md');
  });
});

describe('줄 코멘트 스레드 — 클래스 이름 형식', () => {
  it.each([
    ['old', 'InlineReviewThread-module__ReviewThreadContainer__abc12'],
    ['new', 'ReviewThreadContainer__dO-Lq2'],
  ] as const)('%s', (format, cls) => {
    const file = fakeFile('a.md', true, format);
    expect(hasReviewThreads(file)).toBe(false);
    file.querySelector('.diff-body')!.innerHTML = `<div class="${cls}">스레드</div>`;
    expect(hasReviewThreads(file)).toBe(true);
  });
});

describe('pageVariant', () => {
  it('파일이 없으면 unknown, 옛 화면은 classic', () => {
    document.body.innerHTML = '<div id="diff-comparison-viewer-container"></div>';
    expect(pageVariant(document)).toBe('unknown');
    fakeClassicFile();
    expect(pageVariant(document)).toBe('classic');
  });
});

describe('pageStructure — 파일을 못 찾을 때 알아채기', () => {
  it('파일 링크는 있는데 파일 묶음이 없으면 files 0, links > 0', () => {
    document.body.innerHTML = '<nav><a href="#diff-abc">a.md</a></nav><div class="unknown-file"><h3><code>a.md</code></h3></div>';
    expect(pageStructure(document)).toMatchObject({ files: 0, named: 0, links: 1 });
  });

  it.each(FILE_FORMATS)('%s: 파일과 이름을 센다', (format) => {
    fakeFile('a.md', true, format);
    expect(pageStructure(document)).toMatchObject({ files: 1, named: 1, loading: 0, links: 1 });
  });

  it('뼈대만 있는 파일은 loading으로 센다', () => {
    const file = fakeFile('a.md', true, 'new');
    file.querySelector('h3')!.remove();
    file.querySelector('.diff-body')!.innerHTML = '<div class="skeleton__c5fLaY rounded__er6wPa"></div>';
    expect(pageStructure(document)).toMatchObject({ files: 1, named: 0, loading: 1 });
  });
});

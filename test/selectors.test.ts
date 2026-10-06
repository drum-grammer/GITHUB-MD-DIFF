import { describe, expect, it } from 'vitest';
import {
  fileElements, fileOf, filePath, isMarkdownPath, proseBody, setHidden, tablePairs, unchangedRuns, viewButton,
} from '../src/selectors';
import { addProse, fakeFile, loadFixture } from './helpers';

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

describe('렌더링 본문', () => {
  it('고정 자료: 변경 없는 묶음 3개, 표 쌍 1개', () => {
    const body = loadFixture('handmade-prose.html');
    expect(unchangedRuns(body)).toHaveLength(3);
    const pairs = tablePairs(body);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].oldTable.tBodies[0].rows).toHaveLength(4);
    expect(pairs[0].newTable.tBodies[0].rows).toHaveLength(5);
  });
});

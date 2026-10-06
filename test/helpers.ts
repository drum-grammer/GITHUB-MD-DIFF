import { readFileSync } from 'node:fs';

/** 고정 자료를 document.body에 넣고 .markdown-body를 돌려준다(첫 줄 출처 주석은 뺀다) */
export function loadFixture(name: string): HTMLElement {
  const html = readFileSync(`test/fixtures/${name}`, 'utf8').replace(/^<!--.*?-->\n/, '');
  document.body.innerHTML = html;
  const body = document.querySelector<HTMLElement>('.prose-diff .markdown-body');
  if (!body) throw new Error(`${name}: .prose-diff .markdown-body 없음`);
  return body;
}

/** 새 "Files changed" 화면의 파일 묶음 하나를 본뜬다(2026-10-07 구조) */
export function fakeFile(path = 'docs/a.md', withLabels = true): HTMLElement {
  const lab = (id: string) => (withLabels ? `aria-labelledby="${id}"` : '');
  document.body.innerHTML = `
<div id="diff-abc" class="Diff-module__diffTargetable__x Diff-module__diff__y">
  <div class="DiffFileHeader-module__diff-file-header__z">
    <h3 class="DiffFileHeader-module__file-name__q"><a href="#diff-abc"><code>\u200e${path}\u200e</code></a></h3>
    <button type="button" aria-pressed="true" ${lab('l-src')}><svg class="octicon octicon-code"></svg></button>
    <button type="button" aria-pressed="false" ${lab('l-rich')}><svg class="octicon octicon-file"></svg></button>
    <span id="l-src">Display the source diff</span><span id="l-rich">Display the rich diff</span>
  </div>
  <div class="diff-body"></div>
</div>`;
  const file = document.querySelector<HTMLElement>('#diff-abc');
  if (!file) throw new Error('fakeFile 실패');
  return file;
}

/** 파일 묶음에 렌더링 diff 본문을 넣는다 */
export function addProse(file: HTMLElement): HTMLElement {
  const box = file.querySelector('.diff-body');
  if (!box) throw new Error('fakeFile이 아님');
  box.innerHTML = '<div class="prose-diff"><div><div class="markdown-body"><p class="changed">x</p></div></div></div>';
  return box.querySelector<HTMLElement>('.markdown-body')!;
}

import { readFileSync } from 'node:fs';

/** 고정 자료를 document.body에 넣고 .markdown-body를 돌려준다(첫 줄 출처 주석은 뺀다) */
export function loadFixture(name: string): HTMLElement {
  const html = readFileSync(`test/fixtures/${name}`, 'utf8').replace(/^<!--.*?-->\n/, '');
  document.body.innerHTML = html;
  const body = document.querySelector<HTMLElement>('.prose-diff .markdown-body');
  if (!body) throw new Error(`${name}: .prose-diff .markdown-body 없음`);
  return body;
}

/**
 * 새 "Files changed" 화면의 클래스 이름 형식.
 * old — `Diff-module__diff__해시`(2026-10-07 확인) · new — `diff__해시`(2026-10-14 확인, 로그인 화면이 이것으로 바뀌어 1.5.0이 멈췄다)
 * · bare — 해시 클래스가 하나도 없다(GitHub가 또 다른 형식으로 바꿔도 id·구조만으로 버티는지 본다)
 */
export type FileFormat = 'old' | 'new' | 'bare';
export const FILE_FORMATS: FileFormat[] = ['old', 'new', 'bare'];

const FORMAT_CLASSES: Record<FileFormat, { file: string; wrap: string; header: string; name: string }> = {
  old: {
    file: 'Diff-module__diffTargetable__x Diff-module__diff__y',
    wrap: '',
    header: 'DiffFileHeader-module__diff-file-header__z',
    name: 'DiffFileHeader-module__file-name__q',
  },
  new: { file: 'diffTargetable__jbrCub diff__GZFl4M', wrap: 'diffHeaderWrapper__INiK1j', header: 'diff-file-header__CV6GPS', name: 'file-name__8GKEHg' },
  bare: { file: '', wrap: '', header: '', name: '' },
};

/** 새 "Files changed" 화면의 파일 묶음 하나를 본뜬다(2026-10-07 구조, 형식별 클래스 이름) */
export function fakeFile(path = 'docs/a.md', withLabels = true, format: FileFormat = 'old'): HTMLElement {
  const lab = (id: string) => (withLabels ? `aria-labelledby="${id}"` : '');
  const c = FORMAT_CLASSES[format];
  const header = `
  <div class="${c.header}">
    <h3 class="${c.name}"><a href="#diff-abc"><code>‎${path}‎</code></a></h3>
    <button type="button" aria-pressed="true" ${lab('l-src')}><svg class="octicon octicon-code"></svg></button>
    <button type="button" aria-pressed="false" ${lab('l-rich')}><svg class="octicon octicon-file"></svg></button>
    <span id="l-src">Display the source diff</span><span id="l-rich">Display the rich diff</span>
  </div>`;
  const file = `
<div id="diff-abc" class="${c.file}">${format === 'old' ? header : `\n  <div class="${c.wrap}">${header}</div>`}
  <div class="diff-body"></div>
</div>`;
  // 2026-10-14 화면은 파일들을 id가 diff-로 시작하는 큰 상자(diff-comparison-viewer-container) 안에 둔다
  document.body.innerHTML = format === 'old' ? file : `<div id="diff-comparison-viewer-container">${file}</div>`;
  const el = document.querySelector<HTMLElement>('#diff-abc');
  if (!el) throw new Error('fakeFile 실패');
  return el;
}

/** 파일 묶음에 렌더링 diff 본문을 넣는다 */
export function addProse(file: HTMLElement): HTMLElement {
  const box = file.querySelector('.diff-body');
  if (!box) throw new Error('fakeFile이 아님');
  box.innerHTML = '<div class="prose-diff"><div><div class="markdown-body"><p class="changed">x</p></div></div></div>';
  return box.querySelector<HTMLElement>('.markdown-body')!;
}

/** 옛 "Files changed" 화면(로그아웃 사용자에게 보이는 화면)의 파일 묶음 하나를 본뜬다(2026-10-07 구조) */
export function fakeClassicFile(path = 'docs/a.md'): HTMLElement {
  document.body.innerHTML = `
<div id="diff-abc" class="file js-file js-details-container Details Details--on open" data-file-type=".md">
  <div class="file-header d-flex" data-path="${path}">
    <button type="button" aria-label="Toggle diff contents" aria-expanded="true" class="btn-octicon js-details-target"></button>
    <form class="BtnGroup-parent js-prose-diff-toggle-form"><button type="button" aria-label="Display the source diff" class="btn btn-sm BtnGroup-item source js-source selected"></button></form>
    <form class="BtnGroup-parent js-prose-diff-toggle-form"><button type="button" aria-label="Display the rich diff" class="btn btn-sm BtnGroup-item rendered js-rendered"></button></form>
  </div>
  <div class="js-file-content diff-body"></div>
</div>`;
  const file = document.querySelector<HTMLElement>('#diff-abc');
  if (!file) throw new Error('fakeClassicFile 실패');
  return file;
}

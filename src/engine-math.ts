/**
 * 확장 빌드에서 `katex` 대신 들어가는 대역 — `@vscode/markdown-it-katex`가 부르는 renderToString만 있다(scripts/build-lib.mjs가 바꿔 끼운다).
 * GitHub rich diff는 수식을 서버에서 그리지 않고 `<math-renderer>`에 TeX 원문을 담아 내면 페이지가 MathML로 바꾼다.
 * 확장이 넣은 요소도 페이지가 바꾼다(2026-10-21 testbed #5·#8 확인). 바꾸지 못하면 TeX 원문이 글자로 보인다.
 * 이렇게 KaTeX(약 650 KB)가 content.js에 들어가지 않는다(docs/local-render §4-2)
 */

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderToString(tex: string, options: { displayMode?: boolean } = {}): string {
  return options.displayMode
    ? `<math-renderer class="js-display-math" style="display: block">$$${escape(tex)}$$</math-renderer>`
    : `<math-renderer class="js-inline-math" style="display: inline-block">$${escape(tex)}$</math-renderer>`;
}

export default { renderToString };

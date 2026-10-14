// 스크립트(canary·explore·perf·mapping-report)가 페이지 안에서 확장과 같은 GitHub 가정을 쓰게 한다 — 정본은 src/selectors.ts의 GITHUB_CSS.
// 2026-10-14 GitHub가 클래스 이름 형식을 바꿨을 때 스크립트마다 옛 선택자가 따로 박혀 있어 함께 고쳐야 했다. 이제 selectors.ts만 고친다.
// Node 22.18 이상은 .ts를 그대로 읽는다(타입만 지운다)
import { GITHUB_CSS } from '../src/selectors.ts';

export { GITHUB_CSS };

/**
 * 페이지마다 window.__mdf를 둔다 — css(GITHUB_CSS), files()(파일 묶음), path(f)(파일 경로, 이름이 바뀐 파일은 새 경로).
 * 페이지 안 함수(page.evaluate·addInitScript)에서 window.__mdf.files()처럼 쓴다
 */
export async function installPageCss(context) {
  await context.addInitScript((css) => {
    const nameCode = (f) => [...f.querySelectorAll(css.fileName)].find((c) => !c.closest('.prose-diff, .markdown-body, [data-mdf]')) ?? null;
    window.__mdf = {
      css,
      files: () => [...document.querySelectorAll(css.file)],
      header: (f) => {
        const byClass = f.querySelector(css.header);
        if (byClass) return byClass;
        const name = nameCode(f);
        return name ? ([...f.children].find((c) => c.contains(name)) ?? null) : null;
      },
      path: (f) => {
        const code = nameCode(f);
        const spoken = code?.querySelector('.sr-only')?.textContent ?? '';
        const text = spoken.includes(' renamed to ')
          ? spoken.split(' renamed to ').pop()
          : (code?.textContent ?? f.querySelector('.file-header[data-path]')?.getAttribute('data-path') ?? '');
        return text.replace(/[‎‏]/g, '').trim();
      },
    };
  }, GITHUB_CSS);
}

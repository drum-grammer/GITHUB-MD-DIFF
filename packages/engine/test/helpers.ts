/** 엔진 시험 공용 — 렌더 문맥과 본문 넣기 */
import type { RenderContext } from '../src/index';

/** 이미지 id는 쪽과 경로를 그대로 드러내는 가짜 — 시험이 어느 경로를 발급받았는지 본다 */
export const CTX: RenderContext = { rev: 'r-test', imageId: (side, p) => `${side}-${p.replace(/[^a-z0-9]/gi, '_')}` };

/** 엔진 HTML을 확장이 보는 자리(.prose-diff .markdown-body)에 넣는다 */
export function bodyOf(html: string): HTMLElement {
  document.body.innerHTML = `<div class="prose-diff"><div class="markdown-body"></div></div>`;
  const body = document.querySelector<HTMLElement>('.markdown-body')!;
  body.innerHTML = html;
  return body;
}

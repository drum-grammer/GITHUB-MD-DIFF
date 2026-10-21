/**
 * 확장 빌드에서 엔진의 `packages/engine/src/dom.ts`(jsdom) 대신 들어가는 브라우저판 — 내보내는 이름이 같다(scripts/build-lib.mjs가 바꿔 끼운다).
 * DOMPurify에는 실제 window(trustedTypes만 감춤)를 주고, 엔진이 HTML을 읽고 쓰는 문서는 inert 문서다 — 그 안의 <img>는 불러오지 않고
 * 이벤트 처리기도 돌지 않는다. 정화를 끝낸 HTML 문자열만 페이지에 들어간다(docs/local-render §4-2)
 */

let doc: Document | null = null;
let win: Window | null = null;

/**
 * DOMPurify에 줄 창 — `trustedTypes`만 감춘다. DOMPurify는 있으면 'dompurify' 정책을 만드는데, GitHub CSP의 trusted-types 허용 목록이
 * 막아 페이지에 CSP 위반이 남는다(2026-10-21 testbed #8). 엔진은 정화 결과를 문자열로 받아 inert 문서에만 쓰므로 정책이 필요 없다
 */
export function engineWindow(): Window {
  win ??= new Proxy(window, { get: (target, key) => (key === 'trustedTypes' ? undefined : Reflect.get(target, key)) });
  return win;
}

export function engineDocument(): Document {
  doc ??= document.implementation.createHTMLDocument('');
  return doc;
}

/** HTML 조각을 div 하나에 넣어 돌려준다 */
export function fragment(html: string): HTMLDivElement {
  const div = engineDocument().createElement('div');
  div.innerHTML = html;
  return div;
}

export const TEXT_NODE = 3;
export const ELEMENT_NODE = 1;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

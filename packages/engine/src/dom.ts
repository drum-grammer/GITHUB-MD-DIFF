/**
 * 엔진이 쓰는 DOM — jsdom(parse5: 브라우저와 같은 HTML 파서). 처음 쓸 때 한 번 만든다.
 * 엔진은 브라우저 밖(로컬 서버)에서 돌므로 전역 document에 기대지 않는다
 */
import { JSDOM } from 'jsdom';

let win: Window | null = null;

export function engineWindow(): Window {
  win ??= new JSDOM('<!doctype html><html><body></body></html>').window as unknown as Window;
  return win;
}

export function engineDocument(): Document {
  return engineWindow().document;
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

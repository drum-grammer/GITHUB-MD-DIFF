/** 렌더링 비교 키 — 잎은 정화 뒤 자기 HTML, 최상위 블록은 HTML 전체. 원문 비교가 아니라 렌더링으로 바뀜을 판정한다(스펙 §4-2 4) */
import type { Kind } from './types';

/** 목록 항목의 자기 글에서 빼는 것 — 안쪽 목록·코드·표·인용문은 따로 잎이다(확장 dom-blocks의 ITEM_NESTED와 같은 기준) */
export const ITEM_NESTED = new Set(['UL', 'OL', 'PRE', 'TABLE', 'BLOCKQUOTE']);
/** 보이지 않는 글자 — 폭 없는 문자·양방향 제어 문자·BOM·소프트 하이픈 */
export const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** <pre> 안은 그대로, 밖은 공백을 하나로 */
export function squashOutsidePre(html: string): string {
  return html
    .split(/(<pre[\s\S]*?<\/pre>)/)
    .map((part, i) => (i % 2 ? part : squash(part)))
    .join('')
    .trim();
}

function isItemLike(kind: Kind): boolean {
  return kind === 'item' || kind === 'footnote';
}

/** 잎 요소의 사본에서 자기 것이 아닌 것을 뺀다 — 항목은 안쪽 블록을 빼고, 느슨한 목록의 문단 껍데기를 벗긴다 */
function ownClone(el: Element, kind: Kind): Element {
  const c = el.cloneNode(true) as Element;
  if (!isItemLike(kind)) return c;
  for (const n of [...c.querySelectorAll('ul, ol, pre, table, blockquote')]) n.remove();
  for (const p of [...c.children].filter((x) => x.tagName === 'P')) p.replaceWith(...p.childNodes, ' ');
  return c;
}

/** 잎의 렌더링 키 */
export function leafKey(el: Element, kind: Kind): string {
  if (kind === 'code') {
    // 코드 — info string(class·lang)과 내용, 줄 끝 공백만 지운다. 들여쓰기는 남긴다
    const code = el.querySelector('code');
    const info = `${el.getAttribute('lang') ?? ''}|${code?.getAttribute('class') ?? ''}`;
    return `${info}\n${(el.textContent ?? '').split('\n').map((l) => l.trimEnd()).join('\n')}`;
  }
  if (kind === 'row' || kind === 'meta') {
    // 표 행 — 칸 안쪽만(칸의 align은 표 전체 비교가 잡는다)
    return [...el.children].map((cell) => `${cell.tagName}:${squash(cell.innerHTML)}`).join('\u0001');
  }
  const c = ownClone(el, kind);
  return `${c.tagName}:${squash(c.innerHTML)}`;
}

/** 보이는 글 — 보이지 않는 글자를 빼고 공백을 하나로. 이것이 같은데 키가 다르면 invisible(링크 주소·이미지 src 등) */
export function visibleText(el: Element, kind: Kind): string {
  const text = (ownClone(el, kind).textContent ?? '').replace(INVISIBLE, '');
  // 코드는 들여쓰기가 보이는 글이다
  if (kind === 'code') return text.split('\n').map((l) => l.trimEnd()).join('\n');
  return squash(text);
}

/** 원문에 든 보이지 않는 글자 — 옛·새가 다르면 보이는 글이 달라도 막대로 드러낸다(양방향 제어 문자로 "001"을 "100"처럼 보이게 하는 것) */
export function invisibleChars(source: string): string {
  return (source.match(INVISIBLE) ?? []).join('');
}

/** 최상위 블록의 렌더링 키 — 제목 앵커(슬러그 번호가 문서마다 다를 수 있다)와 순서 목록 시작 번호는 뺀다 */
export function topKey(container: Element): string {
  const c = container.cloneNode(true) as Element;
  for (const a of [...c.querySelectorAll('a.anchor')]) a.remove();
  for (const ol of c.querySelectorAll('ol[start]')) ol.removeAttribute('start');
  return squashOutsidePre(c.innerHTML);
}

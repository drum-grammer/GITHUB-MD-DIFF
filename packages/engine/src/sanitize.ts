/**
 * 원문 HTML(html_block·html_inline) 정화 — DOMPurify + jsdom. 문자열 파서가 아니라 브라우저와 같은 파서로 읽고 다시 써야
 * 해석 어긋남(mXSS)과 짝 안 맞는 `</div>`가 엔진 래퍼를 닫는 일을 막는다. 엔진이 단 클래스·KaTeX 출력은 여기를 거치지 않는다.
 * linkedom은 DOMPurify가 지원하지 않는다(isSupported가 거짓이면 받은 글을 그대로 돌려준다 — 2026-10-16 실측)
 */
import createDOMPurify, { type Config, type DOMPurify, type WindowLike } from 'dompurify';
import { engineDocument, engineWindow } from './dom';
import { safeUrl } from './safe-url';

/** 원문에서 받지 않는 요소 — 스크립트·스타일·폼·삽입 요소, 그리고 이름공간이 바뀌는 svg·math(mXSS 표면을 줄인다) */
const FORBID_TAGS = ['script', 'style', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'frame', 'frameset', 'object', 'embed', 'template', 'noscript', 'dialog', 'svg', 'math'];
/**
 * 페이지 로직이 믿는 표기(data-mdc-*·data-mdf·unchanged·sr-only 등)를 원문이 흉내 내지 못하게. srcset·background·poster·ping은 바깥 주소를 부른다.
 * hidden·popover는 브라우저가 그 내용을 그리지 않는다 — 리뷰에서 안 보이는 지시가 되지 않게 지운다
 */
const FORBID_ATTR = ['class', 'style', 'srcset', 'background', 'poster', 'ping', 'hidden', 'popover'];
/** 브라우저가 안의 글을 그리지 않는 요소 — 벗겨서 글이 보이게 한다 */
const UNWRAP = 'title, datalist, canvas';
/** 대체 내용을 그리지 않는 요소(재생할 수 있으면) — source·track 밖의 자식은 요소 뒤로 꺼낸다 */
const MEDIA_FALLBACK = 'audio, video';
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'cite', 'background', 'longdesc'];

const CONFIG: Config & { RETURN_DOM_FRAGMENT: true } = {
  FORBID_TAGS,
  FORBID_ATTR,
  ALLOW_DATA_ATTR: false,
  // id·name에 user-content- 접두 — <img name="oai">가 document.oai를 가리는 DOM clobbering을 막는다
  SANITIZE_NAMED_PROPS: true,
  RETURN_DOM_FRAGMENT: true,
};

let purify: DOMPurify | null = null;

function purifier(): DOMPurify {
  if (purify) return purify;
  purify = createDOMPurify(engineWindow() as unknown as WindowLike);
  purify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (/^(oai-|on)/i.test(data.attrName)) data.keepAttr = false;
  });
  return purify;
}

/** 원문 HTML 조각을 정화해 다시 쓴 HTML. 사용자 <ins>·<del>은 span.mdc-user-ins·span.mdc-user-del로 바꾼다 */
export function sanitizeHtml(html: string): string {
  const frag = purifier().sanitize(html, CONFIG);
  for (const el of [...frag.querySelectorAll('*')]) {
    for (const name of URL_ATTRS) {
      const v = el.getAttribute(name);
      if (v !== null && !safeUrl(v)) el.removeAttribute(name);
    }
  }
  for (const el of [...frag.querySelectorAll(UNWRAP)]) el.replaceWith(...el.childNodes);
  for (const el of [...frag.querySelectorAll(MEDIA_FALLBACK)]) {
    const fallback = [...el.childNodes].filter((n) => !(n.nodeType === 1 && /^(SOURCE|TRACK)$/.test((n as Element).tagName)));
    el.after(...fallback);
  }
  // 그대로 두면 페이지가 사용자 글을 "지운 블록"(<del>)으로 읽는다
  for (const el of [...frag.querySelectorAll('ins, del')]) {
    const span = el.ownerDocument.createElement('span');
    span.className = el.tagName === 'INS' ? 'mdc-user-ins' : 'mdc-user-del';
    for (const a of [...el.attributes]) span.setAttribute(a.name, a.value);
    span.append(...el.childNodes);
    el.replaceWith(span);
  }
  const div = engineDocument().createElement('div');
  div.append(frag);
  return div.innerHTML;
}

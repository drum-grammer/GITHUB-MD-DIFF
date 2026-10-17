/**
 * 렌더링 파서 — 플러그인을 켠 markdown-it 15. 잎 블록은 확장과 같은 기본 파서(sourceBlocks)가 맡고, 이 파서는 그리기만 한다.
 * GitHub 렌더링에 가깝게: 할 일 상자·알림·각주·수식·이모지, 표는 markdown-accessiblity-table로 감싸고, 제목 뒤에 앵커, Mermaid는 자리표시
 */
import markdownit, { type Env, type MarkdownIt, type Token } from 'markdown-it';
import { footnote } from '@mdit/plugin-footnote';
import { tasklist } from '@mdit/plugin-tasklist';
import katexModule from '@vscode/markdown-it-katex';
import GithubSlugger from 'github-slugger';
import alerts from 'markdown-it-github-alerts';
import { full as emoji } from 'markdown-it-emoji';
import { escapeHtml } from './dom';
import { safeUrl } from './safe-url';
import { sanitizeHtml } from './sanitize';

/** CJS 패키지 — Node ESM에서는 default 아래, esbuild 번들에서는 바로 함수다 */
const katex = ((katexModule as unknown as { default?: typeof katexModule }).default ?? katexModule) as typeof katexModule;

/** 렌더링 환경 — 문서마다 새로(제목 슬러그 중복 번호가 문서 단위다) */
export interface RenderEnv extends Env {
  slugger: GithubSlugger;
}

export function newEnv(): RenderEnv {
  return { slugger: new GithubSlugger() };
}

/** 원문 HTML이 섞인 인라인에서 정화를 건너뛸 토큰 — 엔진·플러그인이 만든 마크업(클래스·스타일이 있다). 할 일 상자(checkbox_input)는 input이라 정화하면 지워진다 */
const TRUSTED_INLINE = new Set(['math_inline', 'footnote_ref', 'emoji', 'image', 'checkbox_input']);

function inlineText(tokens: Token[] | null): string {
  return (tokens ?? []).map((t) => (t.type === 'text' || t.type === 'code_inline' ? t.content : t.children ? inlineText(t.children) : '')).join('');
}

let md: MarkdownIt | null = null;

export function markdown(): MarkdownIt {
  if (md) return md;
  const m = new markdownit('default', { html: true, linkify: true });
  m.validateLink = safeUrl;
  m.use(tasklist, { label: false, containerClass: 'contains-task-list' });
  m.use(alerts);
  // 알림은 GitHub처럼 첫 줄이 [!NOTE] 하나뿐인 인용문만(확장 source-blocks의 ALERT와 같은 규칙). markdown-it-github-alerts 1.0.1은
  // 표시 뒤 글을 정화 없이 제목에 넣고(> [!NOTE] <img onerror=…>가 그대로 나간다), 안쪽 인용문의 닫는 토큰을 짝으로 잡고, 목록 안 [!NOTE]도
  // 알림으로 만든다 — 그래서 플러그인 앞에서 알림이 아닌 인용문과 알림 안의 인용문을 잠시 다른 이름으로 숨기고 뒤에서 되돌린다
  const ALERT_ALONE = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
  const hide = (t: Token): void => {
    t.type = t.type === 'blockquote_open' ? 'mdc_quote_open' : 'mdc_quote_close';
  };
  m.core.ruler.before('github-alerts', 'mdc_alert_guard', (state) => {
    const t = state.tokens;
    for (let i = 0; i < t.length; i++) {
      if (t[i].type !== 'blockquote_open') continue;
      const alert = t[i + 1]?.type === 'paragraph_open' && t[i + 2]?.type === 'inline' && ALERT_ALONE.test(t[i + 2].content);
      for (let j = i, depth = 0; j < t.length; j++) {
        if (t[j].type === 'blockquote_open') depth++;
        else if (t[j].type === 'blockquote_close' && --depth === 0) {
          if (!alert) {
            hide(t[i]);
            hide(t[j]);
          } else for (let k = i + 1; k < j; k++) if (t[k].type === 'blockquote_open' || t[k].type === 'blockquote_close') hide(t[k]);
          break;
        }
      }
    }
  });
  m.core.ruler.after('github-alerts', 'mdc_alert_unguard', (state) => {
    for (const t of state.tokens) {
      if (t.type === 'mdc_quote_open') t.type = 'blockquote_open';
      else if (t.type === 'mdc_quote_close') t.type = 'blockquote_close';
    }
  });
  m.use(footnote);
  // GitHub에는 인라인 각주(^[…])가 없다 — 글자 그대로 둔다(켜 두면 label 없는 각주가 생겨 렌더러가 멈춘다)
  m.inline.ruler.disable('footnoteInline');
  m.use(katex, { throwOnError: false });
  m.use(emoji);

  // 알림 표시 줄([!NOTE]) 바로 뒤가 목록·코드면 플러그인이 빈 문단을 남긴다 — GitHub에는 없고, 짝 잎이 없어 줄 속성도 못 단다
  m.core.ruler.push('mdc_alert_empty_paragraph', (state) => {
    const t = state.tokens;
    for (let i = t.length - 3; i >= 1; i--) {
      if (t[i - 1].type === 'alert_open' && t[i].type === 'paragraph_open' && t[i + 1].type === 'inline' && t[i + 1].content === '' && t[i + 2].type === 'paragraph_close') t.splice(i, 3);
    }
  });

  // 표 정렬 — markdown-it은 style="text-align:…", GitHub는 align="…"
  m.core.ruler.push('mdc_table_align', (state) => {
    for (const t of state.tokens) {
      if (t.type !== 'th_open' && t.type !== 'td_open') continue;
      const m2 = String(t.attrGet('style') ?? '').match(/^text-align:(left|right|center)$/);
      if (!m2) continue;
      t.attrs = (t.attrs ?? []).filter(([k]) => k !== 'style');
      t.attrSet('align', m2[1]);
    }
  });

  const r = m.renderer.rules;
  r.table_open = () => '<markdown-accessiblity-table><table>\n';
  r.table_close = () => '</table></markdown-accessiblity-table>\n';

  r.heading_open = (tokens, idx, _o, env) => {
    const t = tokens[idx];
    t.meta = { slug: (env as unknown as RenderEnv).slugger.slug(inlineText(tokens[idx + 1]?.children ?? null)) };
    return `<${t.tag} class="heading-element">`;
  };
  r.heading_close = (tokens, idx) => {
    const open = tokens[idx - 2];
    return `</${tokens[idx].tag}><a class="anchor" href="#${escapeHtml(String(open?.meta?.slug ?? ''))}"></a>\n`;
  };

  const fence = r.fence!;
  r.fence = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    if (t.info.trim().split(/\s+/)[0] === 'mermaid') {
      return `<section class="js-render-needs-enrichment render-needs-enrichment" data-type="mermaid"><pre lang="mermaid" aria-label="Raw mermaid code">${escapeHtml(t.content)}</pre></section>\n`;
    }
    return fence(tokens, idx, options, env, self);
  };

  // 각주 — GitHub 모양(번호만, data-footnote-ref·backref). 각주 목록은 엔진이 직접 짠다
  r.footnote_ref = (tokens, idx) => {
    const { id, subId, label } = tokens[idx].meta as { id: number; subId: number; label: string };
    const name = escapeHtml(label.toLowerCase());
    const refId = subId > 0 ? `user-content-fnref-${name}-${subId + 1}` : `user-content-fnref-${name}`;
    return `<sup class="footnote-ref"><a href="#user-content-fn-${name}" id="${refId}" data-footnote-ref="" aria-describedby="footnote-label">${id + 1}</a></sup>`;
  };
  r.footnote_anchor = (tokens, idx) => {
    const { id, subId, label } = tokens[idx].meta as { id: number; subId: number; label: string };
    const name = escapeHtml(label.toLowerCase());
    const refId = subId > 0 ? `user-content-fnref-${name}-${subId + 1}` : `user-content-fnref-${name}`;
    return ` <a href="#${refId}" data-footnote-backref="" class="data-footnote-backref" aria-label="Back to reference ${id + 1}">↩</a>`;
  };

  r.html_block = (tokens, idx) => sanitizeHtml(tokens[idx].content);

  // 원문 HTML이 섞인 인라인은 통째로 정화한다(<kbd>와 </kbd>가 따로 토큰이라 하나씩은 못 한다). 엔진 마크업은 자리표시로 비켜 둔다
  // 자리표시는 사용자 영역 문자(U+E000…U+E001)로 감싼다 — 뒤에 숫자가 와도 번호를 잘못 읽지 않게
  const baseInline = m.renderer.renderInline.bind(m.renderer);
  m.renderer.renderInline = (tokens, options, env) => {
    if (!tokens.some((t) => t.type === 'html_inline')) return baseInline(tokens, options, env);
    const slots: string[] = [];
    const nonce = Math.random().toString(36).slice(2, 10);
    let html = '';
    for (const t of tokens) {
      if (t.type === 'html_inline') html += t.content;
      else if (TRUSTED_INLINE.has(t.type)) {
        html += `\uE000${nonce}${slots.length}\uE001`;
        slots.push(baseInline([t], options, env));
      } else html += baseInline([t], options, env);
    }
    return sanitizeHtml(html).replace(new RegExp(`\uE000${nonce}(\\d+)\uE001`, 'g'), (_, k: string) => slots[Number(k)] ?? '');
  };

  md = m;
  return m;
}

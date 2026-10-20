/**
 * Codex 주석 속성(스펙 §7-2) — 정화가 끝난 엔진 HTML에서 줄 속성(data-mdc-new/old)이 달린 요소에만 붙인다.
 * 원문 HTML의 oai-*는 sanitize.ts가 이미 지웠으므로, 여기서 붙인 것만 남는다.
 */
export const ANNOTATION_MAX_VALUE = 256;
export const ANNOTATION_MAX_BYTES = 2048;

/** 지운 쪽 — 확장 prose-markup.ts REMOVED_BLOCK과 같은 선택자(로컬 백엔드도 같은 규칙으로 쪽을 고른다) */
const REMOVED = 'del, .removed';
const RANGE = /^(\d+)-(\d+)$/;
const KIND: Record<string, string> = {
  P: 'paragraph',
  LI: 'list-item',
  TR: 'table-row',
  PRE: 'code',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  BLOCKQUOTE: 'quote',
};

export interface AnnotationMeta {
  path: string;
  side: 'old' | 'new';
  start: number;
  end: number;
  kind: string;
  rev: string;
}

export function annotationLabel(m: AnnotationMeta): string {
  const lines = m.start === m.end ? `L${m.start}` : `L${m.start}–${m.end}`;
  return `${m.path} ${lines}${m.side === 'old' ? ' (old)' : ''}`;
}

function kindOf(el: Element): string {
  if (el.classList.contains('mdc-source-only')) return 'source-only';
  return KIND[el.tagName.toUpperCase()] ?? 'block';
}

export function annotate(body: HTMLElement, path: string, rev: string): void {
  for (const el of body.querySelectorAll('[data-mdc-new], [data-mdc-old]')) {
    const removed = el.closest(REMOVED);
    const side: 'old' | 'new' = removed && body.contains(removed) ? 'old' : 'new';
    const m = RANGE.exec(el.getAttribute(side === 'old' ? 'data-mdc-old' : 'data-mdc-new') ?? '');
    if (!m) continue;
    const meta: AnnotationMeta = { path, side, start: Number(m[1]), end: Number(m[2]), kind: kindOf(el), rev };
    el.setAttribute('oai-annotatable', annotationLabel(meta));
    if (path.length > ANNOTATION_MAX_VALUE) continue;
    const json = JSON.stringify(meta);
    if (new TextEncoder().encode(json).length <= ANNOTATION_MAX_BYTES) el.setAttribute('oai-annotation-metadata', json);
  }
}

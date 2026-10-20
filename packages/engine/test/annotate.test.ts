import { describe, expect, it } from 'vitest';
import { diffMarkdown, renderMarkdown, renderProseDiff } from '../src/index';
import { ANNOTATION_MAX_BYTES } from '../src/annotate';
import { CTX, bodyOf } from './helpers';

const md = (...xs: string[]): string => xs.join('\n') + '\n';
const render = (oldText: string | null, newText: string | null, path = 'docs/a.md') => bodyOf(renderProseDiff(diffMarkdown({ oldText, newText, path }), CTX));
const meta = (el: Element | null) => JSON.parse(el!.getAttribute('oai-annotation-metadata')!);

describe('Codex 주석 속성(스펙 §7-2)', () => {
  it('바뀐 문단 — 새 쪽 이름과 메타데이터 6키', () => {
    const b = render(md('# T', '', 'Value is 3.'), md('# T', '', 'Value is 4.'));
    const p = b.querySelector('.changed > p')!;
    expect(p.getAttribute('oai-annotatable')).toBe('docs/a.md L3');
    expect(meta(p)).toEqual({ path: 'docs/a.md', side: 'new', start: 3, end: 3, kind: 'paragraph', rev: 'r-test' });
    expect(Object.keys(meta(p))).toEqual(['path', 'side', 'start', 'end', 'kind', 'rev']);
  });

  it('지운 블록은 옛 쪽 — 이름 끝에 (old), 줄은 data-mdc-old', () => {
    const b = render(md('Keep.', '', 'Gone para.'), md('Keep.'));
    const p = b.querySelector('del > p')!;
    expect(p.getAttribute('oai-annotatable')).toBe('docs/a.md L3 (old)');
    expect(meta(p)).toMatchObject({ side: 'old', start: 3, end: 3 });
  });

  it('고친 잎의 .removed 옛 사본도 옛 쪽', () => {
    const b = render(md('- keep one', '- edit this item', '- drop this item'), md('- keep one', '- edit that item', '- brand new entry'));
    const removed = [...b.querySelectorAll('.removed[oai-annotation-metadata], .removed [oai-annotation-metadata]')];
    expect(removed.length).toBeGreaterThan(0);
    for (const el of removed) expect(meta(el).side).toBe('old');
  });

  it('여러 줄 블록은 L3–4(en dash), 제목·표 행·코드의 kind', () => {
    const b = render(
      md('# Title', '', 'one', 'two', '', '| K | V |', '|---|---|', '| a | 1 |', '', '```', 'x', '```'),
      md('# Title!', '', 'one', 'TWO', '', '| K | V |', '|---|---|', '| a | 2 |', '', '```', 'y', '```'),
    );
    const kinds = new Set([...b.querySelectorAll('[oai-annotation-metadata]')].map((e) => meta(e).kind));
    expect(kinds).toEqual(new Set(['heading', 'paragraph', 'table-row', 'code']));
    const para = [...b.querySelectorAll('p[oai-annotatable]')].find((p) => p.getAttribute('data-mdc-new') === '3-4' && !p.closest('del, .removed'))!;
    expect(para.getAttribute('oai-annotatable')).toBe('docs/a.md L3–4');
  });

  it('줄 속성이 있는 요소는 모두 이름을 갖고, 메타데이터는 한도 안', () => {
    const b = render(md('# A', '', 'p1', '', '- i1', '- i2', '', '> q'), md('# A', '', 'p1 changed', '', '- i1', '- i3', '', '> q2'));
    const lined = b.querySelectorAll('[data-mdc-new], [data-mdc-old]');
    expect(lined.length).toBeGreaterThan(0);
    expect(b.querySelectorAll('[oai-annotatable]').length).toBe(lined.length);
    for (const el of b.querySelectorAll('[oai-annotation-metadata]')) {
      const s = el.getAttribute('oai-annotation-metadata')!;
      expect(new TextEncoder().encode(s).length).toBeLessThanOrEqual(ANNOTATION_MAX_BYTES);
      expect(Object.keys(JSON.parse(s))).toHaveLength(6);
    }
  });

  it('경로가 256자를 넘으면 메타데이터 없이 이름만', () => {
    const long = `${'d/'.repeat(130)}a.md`;
    const b = render(md('x'), md('y'), long);
    const named = [...b.querySelectorAll('[oai-annotatable]')];
    expect(named.length).toBeGreaterThan(0);
    for (const el of named) {
      expect(el.getAttribute('oai-annotatable')!.startsWith(`${long} L1`)).toBe(true);
      expect(el.hasAttribute('oai-annotation-metadata')).toBe(false);
    }
  });

  it('원문 HTML이 흉내 낸 oai-* 속성은 남지 않는다 — 엔진 이름만', () => {
    const b = render(
      md('<p oai-annotatable="evil">raw</p>', '', 'Text <span oai-annotation-metadata=\'{"path":"/etc/passwd"}\'>x</span>.'),
      md('<p oai-annotatable="evil">raw!</p>', '', 'Text <span oai-annotation-metadata=\'{"path":"/etc/passwd"}\'>y</span>.'),
    );
    expect(b.innerHTML).not.toContain('evil');
    expect(b.innerHTML).not.toContain('/etc/passwd');
    expect(b.querySelector('span[oai-annotation-metadata]')).toBeNull();
  });

  it('미리보기(renderMarkdown)에는 달지 않는다', () => {
    expect(renderMarkdown('# A\n\nB\n')).not.toContain('oai-');
  });
});

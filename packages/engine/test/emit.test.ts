import { describe, expect, it } from 'vitest';
import { diffMarkdown, renderMarkdown, renderProseDiff } from '../src/index';
import { CTX, bodyOf } from './helpers';

const md = (...xs: string[]): string => xs.join('\n') + '\n';
const render = (oldText: string | null, newText: string | null, path = 'docs/a.md', ctx = CTX) => bodyOf(renderProseDiff(diffMarkdown({ oldText, newText, path }), ctx));
const top = (b: HTMLElement) => [...b.children].map((e) => `${e.tagName.toLowerCase()}${e.className ? '.' + e.className.split(' ').join('.') : ''}`);

describe('renderProseDiff — GitHub rich diff 표기(스펙 §4-3)', () => {
  it('바뀐 문단은 div.changed > p.rich-diff-level-one, 앞뒤는 vicinity, 나머지는 expandable.unchanged 묶음', () => {
    const b = render(md('A.', '', 'B.', '', 'Value is 3.', '', 'D.', '', 'E.'), md('A.', '', 'B.', '', 'Value is 4.', '', 'D.', '', 'E.'));
    expect(top(b)).toEqual(['div.expandable.unchanged.js-expandable.rich-diff-level-zero', 'p.vicinity.rich-diff-level-zero', 'div.changed.rich-diff-level-zero', 'p.vicinity.rich-diff-level-zero', 'div.expandable.unchanged.js-expandable.rich-diff-level-zero']);
    expect(b.querySelector('.changed > p.rich-diff-level-one')!.innerHTML).toBe('Value is <del>3</del><ins>4</ins>.');
    expect(b.querySelector('.expandable > p')!.className).toBe('unchanged rich-diff-level-one');
  });

  it('잎마다 줄 속성 — same·changed는 새·옛 둘 다, 추가는 새, 지운 것은 옛', () => {
    const b = render(md('Keep.', '', 'Old para.'), md('Keep.', '', 'Brand new text here.'));
    expect(b.querySelector('p')!.getAttribute('data-mdc-new')).toBe('1-1');
    expect(b.querySelector('p')!.getAttribute('data-mdc-old')).toBe('1-1');
    expect(b.querySelector('ins > p')!.getAttribute('data-mdc-new')).toBe('3-3');
    expect(b.querySelector('ins > p')!.hasAttribute('data-mdc-old')).toBe(false);
    expect(b.querySelector('del > p')!.getAttribute('data-mdc-old')).toBe('3-3');
  });

  it('렌더 판 id는 본문 최상위 요소에만(data-mdc-rev), 엔진 내부 속성은 남지 않는다', () => {
    const b = render(md('a'), md('b'));
    expect([...b.children].every((e) => e.getAttribute('data-mdc-rev') === CTX.rev)).toBe(true);
    expect(b.querySelectorAll('[data-mdc-leaf]').length).toBe(0);
  });

  it('목록 — div.changed > ul.rich-diff-level-one, li.changed(단어)·li.added·li.removed', () => {
    const b = render(md('- keep one', '- edit this item', '- drop this item'), md('- keep one', '- edit that item', '- brand new entry'));
    expect(b.querySelector('.changed > ul')!.className).toBe('rich-diff-level-one');
    expect([...b.querySelectorAll('li')].map((li) => `${li.className}|${li.textContent}`)).toEqual(['|keep one', 'changed|edit thisthat item', 'removed|drop this item', 'added|brand new entry']);
  });

  it('표 — 옛 표 <del>과 새 표 <ins>를 바로 이어서(markdown-accessiblity-table)', () => {
    const b = render(md('| K | V |', '|---|---|', '| a | 1 |'), md('| K | V |', '|---|---|', '| a | 2 |'));
    expect(top(b)).toEqual(['del', 'ins']);
    expect(b.querySelector('del > markdown-accessiblity-table.rich-diff-level-zero > table')).not.toBeNull();
  });

  it('바뀌지 않은 알림은 div.markdown-alert 묶음 그대로', () => {
    const b = render(md('> [!NOTE]', '> Same.', '', 'x'), md('> [!NOTE]', '> Same.', '', 'y'));
    expect(b.querySelector('.markdown-alert > p.markdown-alert-title')).not.toBeNull();
  });

  it('고친 알림은 묶음 없이 제목 문단과 .changed 본문', () => {
    const b = render(md('> [!NOTE]', '> Never include comments.'), md('> [!NOTE]', '> Never include comments or drafts.'));
    expect(b.querySelector('.markdown-alert')).toBeNull();
    expect(top(b)).toEqual(['p.markdown-alert-title.vicinity.rich-diff-level-zero', 'div.changed.rich-diff-level-zero']);
    expect(b.querySelector('.changed')!.textContent).toContain('or drafts');
  });

  it('각주 — 문서 끝 section.footnotes[data-footnotes] 하나(h2.sr-only), 고친 각주는 li.removed + li.added', () => {
    const b = render(md('A[^n].', '', '[^n]: Old note.'), md('A[^n].', '', '[^n]: New note.'));
    const section = b.querySelector('section.footnotes[data-footnotes]')!;
    expect(section.querySelector('h2.sr-only')!.textContent).toBe('Footnotes');
    expect([...section.querySelectorAll('li')].map((li) => li.className)).toEqual(['removed', 'added']);
  });

  it('코드 블록 — 옛 블록 <del>과 새 블록 <ins>', () => {
    const b = render(md('```sh', 'npm test', '```'), md('```sh', 'npm ci', '```'));
    expect(top(b)).toEqual(['del', 'ins']);
  });

  it('Mermaid — section.js-render-needs-enrichment > pre[lang=mermaid]에 줄 속성', () => {
    const b = render(md('```mermaid', 'graph TD', '```'), md('```mermaid', 'graph LR', '```'));
    expect(b.querySelector('ins section.js-render-needs-enrichment > pre[lang="mermaid"]')!.getAttribute('data-mdc-new')).toBe('1-3');
  });

  it('원문만 바뀜 막대 — 계약의 모양 그대로', () => {
    const b = render(md('a *b* c'), md('a _b_ c'));
    const bar = b.querySelector('.mdc-source-only')!;
    expect(bar.className).toBe('changed mdc-source-only rich-diff-level-zero');
    expect(bar.getAttribute('data-mdc-new')).toBe('1-1');
    expect(bar.querySelector('button.mdc-source-only-toggle')!.getAttribute('aria-expanded')).toBe('false');
    const pre = bar.querySelector('pre.mdc-source-diff')!;
    expect(pre.hasAttribute('hidden')).toBe(true);
    expect(pre.innerHTML).toBe('<span class="mdc-del">- a *b* c</span>\n<span class="mdc-ins">+ a _b_ c</span>\n');
  });

  // Review Focus 3 — 원문 HTML이 엔진 표기를 위조
  it('원문 HTML의 class="unchanged"·data-mdc-*·oai-*·<ins>는 엔진 표기가 되지 못한다', () => {
    const forged = '<p class="unchanged" data-mdc-new="999-999" oai-annotatable="x">forged <ins>fake</ins></p>';
    const b = render(md('Intro.'), md('Intro.', '', forged));
    expect(b.innerHTML).not.toContain('999-999');
    expect(b.innerHTML).not.toContain('oai-');
    const p = b.querySelector('ins > p')!;
    expect(p.className).toBe('rich-diff-level-zero');
    expect(p.getAttribute('data-mdc-new')).toBe('3-3');
    expect(p.querySelector('ins')).toBeNull();
    expect(p.querySelector('span.mdc-user-ins')!.textContent).toBe('fake');
  });

  it('지운 파일 — 렌더링 diff 대신 알림 하나', () => {
    const b = render(md('# a'), null);
    expect(b.textContent).toBe('This file was deleted.');
  });
});

describe('이미지 — ctx.imageId, 바깥 주소는 기본으로 막음', () => {
  it('저장소 상대 경로는 서버가 발급한 id로(옛 쪽은 old)', () => {
    const b = render(md('![a](img/one.png)'), md('![a](img/two.png)'));
    expect(b.querySelector('del img')!.getAttribute('src')).toBe(`/file/${encodeURIComponent('old-docs_img_one_png')}`);
    expect(b.querySelector('ins img')!.getAttribute('src')).toBe(`/file/${encodeURIComponent('new-docs_img_two_png')}`);
  });

  it('발급하지 않은(null) 경로·저장소 밖 경로는 막는다', () => {
    const b = render(md('x'), md('![a](../../etc/passwd.png) ![b](ok.png)'), 'docs/a.md', { ...CTX, imageId: () => null });
    expect([...b.querySelectorAll('img')].every((i) => !i.hasAttribute('src') && i.hasAttribute('data-mdc-blocked'))).toBe(true);
  });

  it('http(s) 이미지는 src를 비우고 data-mdc-remote에 — allowRemoteImages면 그대로', () => {
    const b = render(md('x'), md('![r](https://example.com/a.png)'));
    expect(b.querySelector('img')!.getAttribute('data-mdc-remote')).toBe('https://example.com/a.png');
    expect(b.querySelector('img')!.hasAttribute('src')).toBe(false);
    const ok = render(md('x'), md('![r](https://example.com/a.png)'), 'docs/a.md', { ...CTX, allowRemoteImages: true });
    expect(ok.querySelector('img')!.getAttribute('src')).toBe('https://example.com/a.png');
  });

  it('동영상·소리도 같은 규칙 — 바깥 src는 data-mdc-remote, poster는 정화가 지운다', () => {
    const b = render(md('x'), md('<video src="https://t.example/v.mp4" poster="https://t.example/p.png"></video>'));
    expect(b.querySelector('video')!.getAttribute('data-mdc-remote')).toBe('https://t.example/v.mp4');
    expect(b.querySelector('video')!.hasAttribute('src')).toBe(false);
    expect(b.querySelector('video')!.hasAttribute('poster')).toBe(false);
  });
});

describe('renderMarkdown — 코멘트 미리보기', () => {
  it('정화된 HTML, diff 표시 없음, 이미지는 막음', () => {
    const html = renderMarkdown('**bold** <script>x</script> `code` ![i](a.png)\n');
    expect(html).toBe('<p><strong>bold</strong>  <code>code</code> <img alt="i" data-mdc-blocked=""></p>');
  });

  it('각주도 그린다', () => {
    expect(renderMarkdown('a[^1]\n\n[^1]: n\n')).toContain('section class="footnotes" data-footnotes=""');
  });
});

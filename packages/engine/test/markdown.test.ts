import { describe, expect, it } from 'vitest';
import { markdown, newEnv } from '../src/markdown';

const render = (src: string): string => markdown().render(src, newEnv());
const levelZero = (src: string): string[] =>
  markdown()
    .parse(src, newEnv())
    .filter((t) => t.level === 0 && t.nesting !== -1)
    .map((t) => t.type);

describe('렌더링 파서 — 플러그인 1순위(스펙 §4-4)', () => {
  it('할 일 상자 — label 없이, 목록 클래스는 GitHub처럼 contains-task-list', () => {
    expect(render('- [ ] todo\n- [x] done\n')).toBe(
      '<ul class="contains-task-list">\n<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" id="task-item-0" disabled="disabled"> todo</li>\n<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" id="task-item-1" checked="checked" disabled="disabled"> done</li>\n</ul>\n',
    );
  });

  it('알림 — 최상위 토큰 alert_open, 제목 문단 p.markdown-alert-title', () => {
    expect(levelZero('> [!NOTE]\n> Read this.\n')).toEqual(['alert_open']);
    expect(render('> [!WARNING]\n> Careful.\n')).toMatch(/^<div class="markdown-alert markdown-alert-warning"><p class="markdown-alert-title"><svg class="octicon octicon-alert mr-2"[^>]*>.*<\/svg>Warning<\/p><p>Careful.<\/p>\n<\/div>\n$/s);
  });

  it('알림은 [!NOTE]가 그 줄에 혼자일 때만 — 뒤 글은 제목이 되지 않고 정화된다(GitHub와 같음)', () => {
    expect(render('> [!NOTE] <img src=x onerror=alert(1)>\n> body\n')).not.toContain('onerror');
    expect(render('> [!NOTE] <span class="unchanged" data-mdc-new="9-9">x</span>\n> body\n')).not.toMatch(/class="unchanged"|data-mdc-new/);
    expect(render('> - [!NOTE] item\n')).not.toContain('markdown-alert');
    expect(render('> [!NOTE]\n> text\n> > quoted\n>\n> after\n')).toMatch(/<\/blockquote>\n<p>after<\/p>\n<\/div>\n$/);
  });

  it('알림 표시 줄 바로 뒤가 목록이면 빈 문단을 남기지 않는다', () => {
    expect(render('> [!NOTE]\n> - a\n')).not.toContain('<p></p>');
  });

  it('인라인 각주 ^[…]는 GitHub처럼 글자 그대로 — 정규식 글이 엔진을 멈추지 않는다', () => {
    expect(render('Use ^[a-z]+$ here.\n')).toBe('<p>Use ^[a-z]+$ here.</p>\n');
  });

  it('각주 참조 — GitHub처럼 번호만, data-footnote-ref. 정의는 본문 흐름에서 빠져 footnote_block으로', () => {
    expect(levelZero('A[^n].\n\n[^n]: Note.\n')).toEqual(['paragraph_open', 'footnote_block_open', 'footnote_open', 'footnote_anchor']);
    expect(render('A[^n].\n\n[^n]: Note.\n')).toContain('<p>A<sup class="footnote-ref"><a href="#user-content-fn-n" id="user-content-fnref-n" data-footnote-ref="" aria-describedby="footnote-label">1</a></sup>.</p>');
  });

  it('수식 — 인라인은 span.katex, 블록은 math_block 토큰(안에 빈 줄이 있어도 하나)', () => {
    expect(render('$x^2$')).toContain('<span class="katex">');
    expect(levelZero('$$\na\n\nb\n$$\n')).toEqual(['math_block']);
    expect(render('$$\na\n$$\n')).toMatch(/^<p class="katex-block"><span class="katex-display">/);
  });

  it('수식 — \\href 같은 신뢰 명령은 돌지 않는다(KaTeX trust 기본 false)', () => {
    expect(render('$$\n\\href{javascript:alert(1)}{x}\n$$\n')).not.toContain('href="javascript');
  });

  it('이모지 단축어 — 유니코드 글자로', () => {
    expect(render(':tada:')).toBe('<p>🎉</p>\n');
  });

  it('표 — markdown-accessiblity-table로 감싸고 정렬은 align 속성', () => {
    expect(render('| A | B |\n|:-:|--:|\n| 1 | 2 |\n')).toBe(
      '<markdown-accessiblity-table><table>\n<thead>\n<tr>\n<th align="center">A</th>\n<th align="right">B</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align="center">1</td>\n<td align="right">2</td>\n</tr>\n</tbody>\n</table></markdown-accessiblity-table>\n',
    );
  });

  it('제목 — heading-element 클래스, 뒤에 GitHub 슬러그 앵커(중복은 -1)', () => {
    expect(render('# Hello, World!\n\n## Hello, World!\n')).toBe(
      '<h1 class="heading-element">Hello, World!</h1><a class="anchor" href="#hello-world"></a>\n<h2 class="heading-element">Hello, World!</h2><a class="anchor" href="#hello-world-1"></a>\n',
    );
  });

  it('Mermaid — 자리표시만(페이지가 그린다)', () => {
    expect(render('```mermaid\ngraph TD\n```\n')).toBe('<section class="js-render-needs-enrichment render-needs-enrichment" data-type="mermaid"><pre lang="mermaid" aria-label="Raw mermaid code">graph TD\n</pre></section>\n');
  });

  it('자동 링크 — https는 링크, www.는 linkify-it v6 기본값대로 글자(패리티로 정한다)', () => {
    expect(render('https://example.com and www.example.com')).toBe('<p><a href="https://example.com">https://example.com</a> and www.example.com</p>\n');
  });

  it('위험한 마크다운 링크는 링크가 되지 않는다', () => {
    expect(render('[x](javascript:alert(1)) ![y](data:image/png;base64,AA)')).not.toMatch(/href="javascript|src="data:/);
  });
});

describe('렌더링 파서 — 원문 HTML 정화', () => {
  it('html_block은 정화한다', () => {
    expect(render('<div class="unchanged" onclick="x()">a</div>\n')).toBe('<div>a</div>\n');
  });

  it('html_inline이 섞인 인라인은 통째로 정화하되, 엔진·플러그인 마크업(KaTeX·각주·이미지)은 그대로', () => {
    const out = render('Press <kbd class="x">Ctrl</kbd> and $y$ ![i](a.png) <ins>u</ins>[^n].\n\n[^n]: N.\n');
    expect(out).toContain('<kbd>Ctrl</kbd>');
    expect(out).toContain('<span class="katex">');
    expect(out).toContain('<img src="a.png" alt="i">');
    expect(out).toContain('<span class="mdc-user-ins">u</span>');
    expect(out).toContain('<sup class="footnote-ref">');
  });

  it('할 일 상자 + 원문 HTML이 섞인 항목 — 상자가 정화로 지워지지 않는다', () => {
    expect(render('- [x] Press <kbd>Ctrl</kbd>\n')).toContain('<input type="checkbox" class="task-list-item-checkbox" id="task-item-0" checked="checked" disabled="disabled"> Press <kbd>Ctrl</kbd>');
  });

  it('원문 HTML이 섞인 인라인 — 엔진 마크업 바로 뒤 숫자도 남는다(자리표시 경계)', () => {
    expect(render('Logo ![i](a.png)2024 <kbd>K</kbd> :tada:1\n')).toBe('<p>Logo <img src="a.png" alt="i">2024 <kbd>K</kbd> 🎉1</p>\n');
  });
});

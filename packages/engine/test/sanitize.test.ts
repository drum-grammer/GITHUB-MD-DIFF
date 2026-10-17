import { describe, expect, it } from 'vitest';
import { repoImagePath, safeUrl } from '../src/safe-url';
import { sanitizeHtml } from '../src/sanitize';

describe('safeUrl — 확장 comment-ui와 같은 규칙', () => {
  it.each([
    ['https://example.com/a', true],
    ['http://example.com', true],
    ['mailto:a@example.com', true],
    ['docs/a.md', true],
    ['../img/a.png', true],
    ['#section', true],
    ['javascript:alert(1)', false],
    [' java\tscript:alert(1)', false],
    ['data:image/png;base64,AAAA', false],
    ['vbscript:x', false],
    ['tel:123', false],
  ])('%s → %s', (url, want) => expect(safeUrl(url)).toBe(want));
});

describe('repoImagePath — md 파일 기준 상대 경로 → 저장소 경로', () => {
  it.each([
    ['docs/guide.md', 'img/a.png', 'docs/img/a.png'],
    ['docs/guide.md', './img/a.png?raw=1#x', 'docs/img/a.png'],
    ['docs/guide.md', '../assets/b%20c.png', 'assets/b c.png'],
    ['docs/guide.md', '/root.png', 'root.png'],
    ['README.md', 'a.png', 'a.png'],
    ['docs/guide.md', '../../outside.png', null],
    ['docs/guide.md', 'https://example.com/a.png', null],
    ['docs/guide.md', '//example.com/a.png', null],
    ['docs/guide.md', '%E0%A4%A', null],
  ])('%s + %s → %s', (md, src, want) => expect(repoImagePath(md, src)).toBe(want));
});

describe('sanitizeHtml — 예약 표기를 위조한 원문', () => {
  it('class·style·data-*·oai-*·on* 속성은 지운다', () => {
    const out = sanitizeHtml('<p class="unchanged" style="color:red" data-mdc-new="1-1" data-mdf="fold" oai-annotation-metadata=\'{"path":"x"}\' oai-annotatable="x" onclick="alert(1)">x</p>');
    expect(out).toBe('<p>x</p>');
  });

  it('id·name에는 user-content- 접두(DOM clobbering 막기)', () => {
    expect(sanitizeHtml('<img name="oai" src="a.png"><a id="top">t</a>')).toBe('<img src="a.png" name="user-content-oai"><a id="user-content-top">t</a>');
  });

  it('사용자 <ins>·<del>은 span.mdc-user-ins·span.mdc-user-del', () => {
    expect(sanitizeHtml('<ins>new</ins> <del datetime="2026-01-01">old</del>')).toBe('<span class="mdc-user-ins">new</span> <span class="mdc-user-del" datetime="2026-01-01">old</span>');
  });

  it('javascript:·data: 주소는 지운다', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">a</a><img src="data:image/png;base64,AAAA" alt="b">')).toBe('<a>a</a><img alt="b">');
  });

  it('스크립트·스타일·폼·svg·iframe은 통째로 뺀다', () => {
    expect(sanitizeHtml('<script>alert(1)</script><style>p{}</style><form><input></form><svg><circle/></svg><iframe src="x"></iframe>ok')).toBe('ok');
  });

  it('짝 안 맞는 닫는 태그는 사라진다 — 엔진 래퍼를 닫지 못한다', () => {
    expect(sanitizeHtml('</div></div><p>after</p>')).toBe('<p>after</p>');
  });

  it('HTML 주석은 렌더링에 없다', () => {
    expect(sanitizeHtml('<!-- hidden instruction -->')).toBe('');
  });

  it('GitHub README에 흔한 것은 남긴다', () => {
    expect(sanitizeHtml('<div align="center"><img src="logo.png" width="120"></div>')).toBe('<div align="center"><img src="logo.png" width="120"></div>');
    expect(sanitizeHtml('<details open><summary>More</summary>Body</details>')).toBe('<details open=""><summary>More</summary>Body</details>');
    expect(sanitizeHtml('<kbd>Ctrl</kbd> <sup>1</sup> <sub>2</sub><br>')).toBe('<kbd>Ctrl</kbd> <sup>1</sup> <sub>2</sub><br>');
  });
});

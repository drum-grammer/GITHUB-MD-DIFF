import { beforeEach, describe, expect, it, vi } from 'vitest';
import { undoAll } from '../src/apply';
import { localBody } from '../src/autorich';
import type { FileInfo, PrData } from '../src/github-api';
import { LocalRenderer, MAX_SOURCE_CHARS, insertLocalBody, noteLocal, renderFile } from '../src/local-render';
import { loadPr, loadText } from '../src/pr-cache';
import { mappingFromAttributes } from '../src/dom-blocks';
import { fakeFile } from './helpers';

// 확장 빌드처럼 엔진이 브라우저판 DOM(inert 문서)을 쓰게 한다 — scripts/build-lib.mjs의 engineForBrowser와 같은 바꿔 끼우기
vi.mock('../packages/engine/src/dom', async () => await import('../src/engine-dom'));
vi.mock('../src/pr-cache', () => ({ loadPr: vi.fn(), loadText: vi.fn() }));

/** GitHub가 504 뒤 그리는 본문(2026-10-21) */
const RICH_FAILED_HTML =
  '<div class="border position-relative rounded-bottom-2"><div class="d-flex flex-justify-center tmp-p-4">This rich diff is not supported at the moment.</div></div>';

const PR = { owner: 'lantern', repo: 'docs', number: 7 };

function prData(files: FileInfo[]): PrData {
  return { baseOid: 'b'.repeat(40), headOid: 'h'.repeat(40), pendingReviewId: null, repositoryId: null, pullRequestId: null, files: new Map(files.map((f) => [f.path, f])) };
}

function failedFile(): HTMLElement {
  const file = fakeFile('docs/guide.md', true, 'new');
  file.querySelector('.diff-body')!.innerHTML = RICH_FAILED_HTML;
  return file;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('insertLocalBody', () => {
  it('GitHub 렌더링과 같은 껍데기로 본문 상자 안에 넣고 GitHub 실패 안내를 숨긴다 — 두 번 불러도 하나', () => {
    const file = failedFile();
    const body = insertLocalBody(file, '<p class="changed" data-mdc-new="3-3">Lantern <ins>now</ins> syncs</p>')!;
    expect(insertLocalBody(file, '<p>again</p>')).toBe(body);
    expect(file.querySelectorAll('[data-mdf-local]')).toHaveLength(1);
    const wrap = file.querySelector('[data-mdf-local]')!;
    expect(wrap.className).toBe('prose-diff position-relative');
    expect(wrap.parentElement!.classList.contains('diff-body')).toBe(true);
    expect(body.tagName).toBe('ARTICLE');
    expect(body.className).toBe('markdown-body entry-content container-lg');
    expect(body.parentElement!.parentElement).toBe(wrap);
    expect(localBody(file)).toBe(body);
    expect(file.querySelector('.d-flex.flex-justify-center')!.classList.contains('mdf-hidden')).toBe(true);
  });

  it('한 번 더 거른다 — 스크립트·이벤트 속성·javascript: 주소. GitHub가 그림을 붙이는 훅 클래스는 뗀다', () => {
    const file = failedFile();
    const body = insertLocalBody(
      file,
      '<p onclick="x()">a <a href="javascript:alert(1)">b</a></p><script>bad()</script>' +
        '<section class="js-render-needs-enrichment render-needs-enrichment" data-type="mermaid"><pre lang="mermaid">graph TD</pre></section>',
    )!;
    expect(body.querySelector('script')).toBeNull();
    expect(body.querySelector('p')!.hasAttribute('onclick')).toBe(false);
    expect(body.querySelector('a')!.hasAttribute('href')).toBe(false);
    const section = body.querySelector('section')!;
    expect(section.classList.contains('js-render-needs-enrichment')).toBe(false);
    expect(section.classList.contains('render-needs-enrichment')).toBe(true);
  });

  it('본문 상자를 못 찾으면 넣지 않는다', () => {
    const file = failedFile();
    file.querySelector('.diff-body')!.remove();
    expect(insertLocalBody(file, '<p>x</p>')).toBeNull();
  });

  it('undoAll이 본문을 걷고 실패 안내를 되돌린다', () => {
    const file = failedFile();
    insertLocalBody(file, '<p>x</p>');
    noteLocal(file, 'rendered', () => {});
    undoAll(document);
    expect(file.querySelector('[data-mdf-local]')).toBeNull();
    expect(file.querySelector('[data-mdf="local-rich"]')).toBeNull();
    expect(file.querySelector('.d-flex.flex-justify-center')!.classList.contains('mdf-hidden')).toBe(false);
  });
});

describe('noteLocal', () => {
  it('파일 머리 아래 한 줄 — 그리는 중 → 그렸다로 바꾸고, null이면 걷는다. 버튼은 원문 보기', () => {
    const file = failedFile();
    let source = 0;
    noteLocal(file, 'rendering', () => source++);
    noteLocal(file, 'rendering', () => source++);
    const notes = () => file.querySelectorAll<HTMLElement>('[data-mdf="local-rich"]');
    expect(notes()).toHaveLength(1);
    expect(notes()[0].textContent).toContain('localRendering');
    expect(notes()[0].previousElementSibling?.querySelector('h3')).not.toBeNull();
    noteLocal(file, 'rendered', () => source++);
    expect(notes()).toHaveLength(1);
    expect(notes()[0].textContent).toContain('localRendered');
    notes()[0].querySelector('button')!.click();
    expect(source).toBe(1);
    noteLocal(file, null, () => {});
    expect(notes()).toHaveLength(0);
  });
});

describe('LocalRenderer', () => {
  it('한 번만 그리고 HTML을 기억한다 — 끝나면 다시 훑게 하고, 본문이 사라져도 엔진을 다시 돌리지 않는다', async () => {
    const file = failedFile();
    const render = vi.fn(async () => '<p class="changed" data-mdc-new="1-1">x</p>');
    const settled = vi.fn();
    const r = new LocalRenderer(settled, render);
    expect(r.step(file, 'k', PR, 'docs/guide.md')).toBe('pending');
    expect(r.step(file, 'k', PR, 'docs/guide.md')).toBe('pending');
    await settle();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(r.step(file, 'k', PR, 'docs/guide.md')).toBe('ready');
    expect(localBody(file)).not.toBeNull();
    file.querySelector('[data-mdf-local]')!.remove(); // GitHub가 상자를 다시 그렸다
    expect(r.step(file, 'k', PR, 'docs/guide.md')).toBe('ready');
    expect(localBody(file)).not.toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('한 번에 한 파일씩 — 앞 파일이 끝난 뒤 다음을 그린다', async () => {
    const file = failedFile();
    const order: string[] = [];
    let release: () => void = () => {};
    const render = vi.fn(async (_pr: unknown, path: string) => {
      order.push(`start ${path}`);
      if (path === 'a.md') await new Promise<void>((r) => (release = r));
      order.push(`end ${path}`);
      return '<p>x</p>';
    });
    const r = new LocalRenderer(() => {}, render);
    r.step(file, 'a', PR, 'a.md');
    r.step(file, 'b', PR, 'b.md');
    await settle();
    expect(order).toEqual(['start a.md']);
    release();
    await settle();
    expect(order).toEqual(['start a.md', 'end a.md', 'start b.md', 'end b.md']);
  });

  it('못 그리면 failed를 한 번 알리고 잊는다(사람이 다시 고르면 한 번 더) — 콘솔에 까닭', async () => {
    const file = failedFile();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const render = vi.fn(async () => {
      throw new Error('HTTP 500');
    });
    const r = new LocalRenderer(() => {}, render);
    r.step(file, 'k', PR, 'docs/guide.md');
    await settle();
    expect(r.step(file, 'k', PR, 'docs/guide.md')).toBe('failed');
    expect(warn).toHaveBeenCalledWith('[github-md-diff]', 'docs/guide.md', expect.any(Error));
    expect(r.step(file, 'k', PR, 'docs/guide.md')).toBe('pending');
    await settle();
    expect(render).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('renderFile — 원문 받기 + 엔진(브라우저판 DOM)', () => {
  const OLD = '# Lantern\n\nLantern syncs notes.\n\n![logo](img/logo.png)\n';
  const NEW = '# Lantern\n\nLantern syncs notes and tasks.\n\n![logo](img/logo.png)\n\n<img src="x" onerror="alert(1)">\n';

  beforeEach(() => {
    vi.mocked(loadPr).mockReset();
    vi.mocked(loadText).mockReset();
  });

  it('PR의 base·head 원문으로 그린다 — 줄 속성은 원문 줄, 저장소 이미지는 raw 주소, Codex 속성 없음, 원문 HTML은 정화', async () => {
    vi.mocked(loadPr).mockResolvedValue(prData([{ path: 'docs/guide.md', oldPath: null, changeType: 'MODIFIED', threads: [] }]));
    vi.mocked(loadText).mockImplementation(async (_pr, oid) => (oid.startsWith('b') ? OLD : NEW));
    const html = await renderFile(PR, 'docs/guide.md');
    expect(vi.mocked(loadText).mock.calls.map((c) => [c[1][0], c[2]])).toEqual([['b', 'docs/guide.md'], ['h', 'docs/guide.md']]);
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('ins')!.textContent).toContain('and tasks');
    const targets = [...mappingFromAttributes(div).values()].map((t) => `${t.side} ${t.start}-${t.end}`);
    expect(targets).toContain('right 3-3');
    expect(div.querySelector<HTMLImageElement>('img[alt="logo"]')!.getAttribute('src')).toBe(`/lantern/docs/raw/${'h'.repeat(40)}/docs/img/logo.png`);
    expect(html).not.toMatch(/oai-annotat/);
    expect(html).not.toMatch(/onerror/);
  });

  it('추가된 파일은 옛 원문을 받지 않고, 이름 바뀐 파일은 옛 경로로 base를 받는다', async () => {
    vi.mocked(loadText).mockResolvedValue(NEW);
    vi.mocked(loadPr).mockResolvedValue(prData([{ path: 'docs/new.md', oldPath: null, changeType: 'ADDED', threads: [] }]));
    await renderFile(PR, 'docs/new.md');
    expect(vi.mocked(loadText).mock.calls.map((c) => c[2])).toEqual(['docs/new.md']);
    vi.mocked(loadText).mockClear();
    vi.mocked(loadPr).mockResolvedValue(prData([{ path: 'docs/b.md', oldPath: 'docs/a.md', changeType: 'RENAMED', threads: [] }]));
    await renderFile(PR, 'docs/a.md → docs/b.md');
    expect(vi.mocked(loadText).mock.calls.map((c) => [c[1][0], c[2]])).toEqual([['b', 'docs/a.md'], ['h', 'docs/b.md']]);
  });

  it('지운 파일은 새 원문을 받지 않는다', async () => {
    vi.mocked(loadText).mockResolvedValue(OLD);
    vi.mocked(loadPr).mockResolvedValue(prData([{ path: 'docs/old.md', oldPath: null, changeType: 'REMOVED', threads: [] }]));
    await renderFile(PR, 'docs/old.md');
    expect(vi.mocked(loadText).mock.calls.map((c) => c[1][0])).toEqual(['b']);
  });

  it(`옛·새 원문이 합쳐 ${MAX_SOURCE_CHARS.toLocaleString('en')}자를 넘으면 그리지 않는다`, async () => {
    vi.mocked(loadPr).mockResolvedValue(prData([{ path: 'docs/guide.md', oldPath: null, changeType: 'MODIFIED', threads: [] }]));
    vi.mocked(loadText).mockResolvedValue('x'.repeat(MAX_SOURCE_CHARS / 2 + 1));
    await expect(renderFile(PR, 'docs/guide.md')).rejects.toThrow(/too large/);
  });

  it('원문을 못 받으면 실패한다', async () => {
    vi.mocked(loadPr).mockResolvedValue(prData([{ path: 'docs/guide.md', oldPath: null, changeType: 'MODIFIED', threads: [] }]));
    vi.mocked(loadText).mockRejectedValue(new Error('HTTP 500'));
    await expect(renderFile(PR, 'docs/guide.md')).rejects.toThrow('HTTP 500');
  });
});

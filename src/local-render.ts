/**
 * 로컬 렌더링 — GitHub가 렌더링 diff를 만들지 못한 md 파일(큰 파일의 서버 시간 초과)을 확장 안의 엔진(packages/engine)으로 그린다.
 * 옛·새 원문은 코멘트와 같은 요청·캐시(pr-cache.ts)로 받고, 그린 본문은 GitHub 렌더링과 같은 껍데기로 같은 자리에 넣는다.
 * 그 뒤 접기·표 합치기·이동·코멘트는 GitHub 렌더링 때와 같은 길이다. 설계: docs/local-render
 */
import { localBody, removeLocalBody } from './autorich';
import { noticeBox, safeFragment } from './comment-ui';
import { commentPath } from './comments';
import { REMOVED_CHANGE, rawFileUrl, type PrRef } from './github-api';
import { t } from './i18n';
import { loadPr, loadText } from './pr-cache';
import { HEAD_ATTR, LOCAL_ATTR, MDF_ATTR, diffBodyBox, headerBlock, richFailureNotice, setHidden } from './selectors';

/**
 * 옛·새 원문을 합쳐 이보다 크면 엔진을 돌리지 않는다(원문 보기로). 엔진은 그동안 화면을 붙잡는다 — 브라우저에서 37만 자·15곳 고침이 0.5초,
 * 16만 자·2,400곳 모두 고침이 1.2초였다(2026-10-21). 한 쪽 약 60만 자까지 — 계기가 된 437 KB 문서가 들어간다
 */
export const MAX_SOURCE_CHARS = 1_200_000;

/** 원문 받기 + 엔진이 이보다 오래 걸리면 못 그린 것으로 본다(요청 하나는 20초에서 끊긴다) — 다음 파일이 기다리지 않게 차례를 놓는다 */
export const RENDER_TIMEOUT_MS = 60_000;
/** 그렸는데 넣을 본문 상자가 이만큼 없으면(GitHub 화면이 다르다) 못 그린 것으로 본다 */
export const NO_BOX_MS = 10_000;
/** 기억하는 HTML 수 — 넘으면 오래된 것부터 잊는다(큰 문서 하나가 수 MB다) */
export const MAX_ENTRIES = 20;

const NOTE = 'local-rich';
/** GitHub가 그림(Mermaid 등)을 붙이는 자리의 훅 클래스 */
const ENRICHMENT = 'js-render-needs-enrichment';
const LOG = '[github-md-diff]';

/** 엔진이 그린 HTML과 그 원문의 두 커밋 */
export interface Rendered {
  html: string;
  baseOid: string;
  headOid: string;
}

type Entry =
  | { state: 'pending' }
  | ({ state: 'ready'; missingSince?: number; stale?: boolean; checking?: boolean } & Rendered)
  | { state: 'failed' };

export type LocalStep = 'pending' | 'ready' | 'failed';

/** 엔진 모듈 — 처음 쓸 때만 불러 초기화한다(content.js 한 파일 안에서 esbuild가 지연 초기화로 묶는다) */
type Engine = typeof import('../packages/engine/src/index');
let engine: Promise<Engine> | null = null;
const loadEngine = (): Promise<Engine> => (engine ??= import('../packages/engine/src/index'));

/** 화면이 안내를 먼저 그리게 한 프레임 쉰다 — 엔진은 큰 파일에서 1초쯤 화면을 붙잡는다 */
const nextFrame = (): Promise<void> => new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));

/** 옛·새 원문을 받아 엔진으로 렌더링 diff HTML을 만든다 — `.prose-diff .markdown-body` 안쪽 */
export async function renderFile(pr: PrRef, displayPath: string): Promise<Rendered> {
  const path = commentPath(displayPath);
  const d = await loadPr(pr);
  const info = d.files.get(path);
  const added = info?.changeType === 'ADDED';
  const removed = REMOVED_CHANGE.has(info?.changeType ?? '');
  const oldPath = info?.oldPath ?? path;
  const [oldText, newText] = await Promise.all([added ? null : loadText(pr, d.baseOid, oldPath), removed ? null : loadText(pr, d.headOid, path)]);
  if ((oldText?.length ?? 0) + (newText?.length ?? 0) > MAX_SOURCE_CHARS) throw new Error('source too large to render in the browser');
  const { diffMarkdown, renderProseDiff } = await loadEngine();
  await nextFrame();
  const diff = diffMarkdown({ oldText, newText, path, oldPath: info?.oldPath ?? undefined });
  const html = renderProseDiff(diff, {
    rev: 'github',
    imageId: () => null,
    imageUrl: (side, repoPath) => rawFileUrl(pr, side === 'old' ? d.baseOid : d.headOid, repoPath),
    annotations: false,
  });
  return { html, baseOid: d.baseOid, headOid: d.headOid };
}

/** 그린 HTML을 GitHub 렌더링과 같은 껍데기로 본문 상자 안에 넣고 GitHub 실패 안내를 숨긴다. 상자가 없으면 null. `headOid`는 껍데기에 적는다 */
export function insertLocalBody(file: HTMLElement, html: string, headOid?: string): HTMLElement | null {
  const existing = localBody(file);
  if (existing) return existing;
  const box = diffBodyBox(file);
  if (!box) return null;
  const doc = file.ownerDocument;
  const wrap = doc.createElement('div');
  wrap.className = 'prose-diff position-relative';
  wrap.setAttribute(LOCAL_ATTR, '');
  if (headOid) wrap.setAttribute(HEAD_ATTR, headOid);
  const inner = doc.createElement('div');
  const article = doc.createElement('article');
  article.className = 'markdown-body entry-content container-lg';
  // 엔진이 원문 HTML을 inert 문서에서 정화했다(packages/engine/src/sanitize.ts). 로컬 리뷰 페이지처럼 한 번 더 거른다(스크립트·이벤트 속성·위험한 주소)
  article.append(safeFragment(doc, html));
  // Mermaid 자리표시는 GitHub 표기를 흉내 낸다 — GitHub 스크립트가 이 클래스를 보고 그림 iframe을 찾다 오류를 낸다(2026-10-21). 코드 블록으로만 둔다
  for (const el of article.querySelectorAll(`.${ENRICHMENT}`)) el.classList.remove(ENRICHMENT);
  inner.append(article);
  wrap.append(inner);
  box.append(wrap);
  hideGitHubNotice(file);
  return article;
}

/** GitHub의 실패 안내를 숨긴다 — React가 다시 그려 새 안내가 나오면 다시 숨긴다. 지우지 않는다(React가 관리하는 요소다) */
export function hideGitHubNotice(file: HTMLElement): void {
  const notice = richFailureNotice(file);
  if (notice) setHidden(notice, true);
}

/**
 * 파일 머리 아래 안내 한 줄 — `rendering`(그리는 중)·`rendered`(그렸다), null이면 걷는다. 버튼은 둘 다 원문 보기(사람의 선택)
 */
export function noteLocal(file: HTMLElement, phase: 'rendering' | 'rendered' | null, showSource: () => void): void {
  const old = file.querySelector<HTMLElement>(`[${MDF_ATTR}="${NOTE}"]`);
  if (old?.dataset.phase === phase) return;
  old?.remove();
  if (!phase) return;
  const top = headerBlock(file);
  if (!top) return;
  const box = noticeBox(file.ownerDocument, t(phase === 'rendering' ? 'localRendering' : 'localRendered'), t('showSource'), showSource);
  box.setAttribute(MDF_ATTR, NOTE);
  box.dataset.phase = phase;
  top.after(box);
}

/**
 * 파일마다 한 번 그리고 HTML을 기억한다 — GitHub가 상자를 다시 그려 본문이 사라져도 엔진을 다시 돌리지 않는다.
 * 기억한 HTML을 다시 넣을 때는 PR의 머리 커밋이 그대로인지 본다(바뀌었으면 다시 그린다 — 낡은 줄 번호로 코멘트가 올라가지 않게).
 * 한 번에 한 파일씩(엔진이 화면을 붙잡는 동안 다른 파일이 겹치지 않게), 한 파일은 RENDER_TIMEOUT_MS까지. 끝나면 `onSettled`로 다시 훑게 한다
 */
export class LocalRenderer {
  private readonly entries = new Map<string, Entry>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly onSettled: () => void,
    private readonly render: (pr: PrRef, path: string) => Promise<Rendered> = renderFile,
    /** 지금 PR의 머리 커밋 — PR 데이터 캐시(1분)를 쓴다 */
    private readonly headOf: (pr: PrRef) => Promise<string> = (pr) => loadPr(pr).then((d) => d.headOid),
  ) {}

  /** 그릴 차례를 잡거나(pending), 그린 본문을 넣거나(ready), 못 그렸다고(failed) 알린다 */
  step(file: HTMLElement, key: string, pr: PrRef, path: string, now = Date.now()): LocalStep {
    const entry = this.entries.get(key);
    if (!entry || (entry.state === 'ready' && entry.stale)) {
      removeLocalBody(file);
      this.start(key, pr, path);
      return 'pending';
    }
    if (entry.state === 'pending') return 'pending';
    if (entry.state === 'failed') {
      this.entries.delete(key); // 사람이 렌더링을 다시 고르면 한 번 더 해 본다(autorich가 localFailed로 막는다)
      return 'failed';
    }
    this.checkHead(entry, key, pr);
    if (insertLocalBody(file, entry.html, entry.headOid)) {
      entry.missingSince = undefined;
      return 'ready';
    }
    entry.missingSince ??= now;
    if (now - entry.missingSince < NO_BOX_MS) return 'pending';
    entry.missingSince = undefined; // HTML은 기억해 둔다 — 사람이 렌더링을 다시 고르면 다시 넣어 본다
    return 'failed';
  }

  private start(key: string, pr: PrRef, path: string): void {
    const entry: Entry = { state: 'pending' };
    this.entries.set(key, entry);
    this.queue = this.queue.then(async () => {
      if (this.entries.get(key) !== entry) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no result in ${RENDER_TIMEOUT_MS / 1000}s`)), RENDER_TIMEOUT_MS);
      });
      try {
        const r = await Promise.race([this.render(pr, path), timeout]);
        if (this.entries.get(key) === entry) this.remember(key, { state: 'ready', ...r });
      } catch (error) {
        console.warn(LOG, path, error);
        if (this.entries.get(key) === entry) this.entries.set(key, { state: 'failed' });
      } finally {
        clearTimeout(timer);
        this.onSettled();
      }
    });
  }

  private remember(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    for (const [k, e] of this.entries) {
      if (this.entries.size <= MAX_ENTRIES) break;
      if (e.state !== 'pending' && k !== key) this.entries.delete(k);
    }
  }

  /** 기억한 HTML이 지금 머리 커밋의 것인지 — 아니면 낡았다고 적고 다시 훑게 한다(다음 step이 다시 그린다) */
  private checkHead(entry: Extract<Entry, { state: 'ready' }>, key: string, pr: PrRef): void {
    if (entry.checking) return;
    entry.checking = true;
    this.headOf(pr).then(
      (head) => {
        entry.checking = false;
        if (head === entry.headOid || this.entries.get(key) !== entry) return;
        entry.stale = true;
        this.onSettled();
      },
      () => {
        entry.checking = false;
      },
    );
  }
}

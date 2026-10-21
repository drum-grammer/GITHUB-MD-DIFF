/**
 * 로컬 렌더링 — GitHub가 렌더링 diff를 만들지 못한 md 파일(큰 파일의 서버 시간 초과)을 확장 안의 엔진(packages/engine)으로 그린다.
 * 옛·새 원문은 코멘트와 같은 요청·캐시(pr-cache.ts)로 받고, 그린 본문은 GitHub 렌더링과 같은 껍데기로 같은 자리에 넣는다.
 * 그 뒤 접기·표 합치기·이동·코멘트는 GitHub 렌더링 때와 같은 길이다. 설계: docs/local-render
 */
import { localBody } from './autorich';
import { noticeBox } from './comment-ui';
import { commentPath } from './comments';
import { REMOVED_CHANGE, rawFileUrl, type PrRef } from './github-api';
import { t } from './i18n';
import { loadPr, loadText } from './pr-cache';
import { LOCAL_ATTR, MDF_ATTR, diffBodyBox, headerBlock, richFailureNotice, setHidden } from './selectors';

/** 옛·새 원문을 합쳐 이보다 크면 엔진을 돌리지 않는다(원문 보기로) — 브라우저에서 37만 자·15곳 고침이 0.5초, 2,400곳 고침이 1.2초였다 */
export const MAX_SOURCE_CHARS = 2_000_000;

const NOTE = 'local-rich';
const LOG = '[github-md-diff]';

type Entry =
  | { state: 'pending' }
  | { state: 'ready'; html: string }
  | { state: 'failed' };

export type LocalStep = 'pending' | 'ready' | 'failed';

/** 엔진 모듈 — 처음 쓸 때만 불러 초기화한다(content.js 한 파일 안에서 esbuild가 지연 초기화로 묶는다) */
type Engine = typeof import('../packages/engine/src/index');
let engine: Promise<Engine> | null = null;
const loadEngine = (): Promise<Engine> => (engine ??= import('../packages/engine/src/index'));

/** 화면이 안내를 먼저 그리게 한 프레임 쉰다 — 엔진은 큰 파일에서 1초쯤 화면을 붙잡는다 */
const nextFrame = (): Promise<void> => new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));

/** 옛·새 원문을 받아 엔진으로 렌더링 diff HTML을 만든다 — `.prose-diff .markdown-body` 안쪽 */
export async function renderFile(pr: PrRef, displayPath: string): Promise<string> {
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
  return renderProseDiff(diff, {
    rev: 'github',
    imageId: () => null,
    imageUrl: (side, repoPath) => rawFileUrl(pr, side === 'old' ? d.baseOid : d.headOid, repoPath),
    annotations: false,
  });
}

/** 그린 HTML을 GitHub 렌더링과 같은 껍데기로 본문 상자 안에 넣고 GitHub 실패 안내를 숨긴다. 상자가 없으면 null */
export function insertLocalBody(file: HTMLElement, html: string): HTMLElement | null {
  const existing = localBody(file);
  if (existing) return existing;
  const box = diffBodyBox(file);
  if (!box) return null;
  const doc = file.ownerDocument;
  const wrap = doc.createElement('div');
  wrap.className = 'prose-diff position-relative';
  wrap.setAttribute(LOCAL_ATTR, '');
  const inner = doc.createElement('div');
  const article = doc.createElement('article');
  article.className = 'markdown-body entry-content container-lg';
  article.innerHTML = html; // 엔진이 원문 HTML을 inert 문서에서 정화한 결과(packages/engine/src/sanitize.ts)
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
 * 한 번에 한 파일씩(엔진이 화면을 붙잡는 동안 다른 파일이 겹치지 않게). 끝나면 `onSettled`로 다시 훑게 한다
 */
export class LocalRenderer {
  private readonly entries = new Map<string, Entry>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly onSettled: () => void,
    private readonly render: (pr: PrRef, path: string) => Promise<string> = renderFile,
  ) {}

  /** 그릴 차례를 잡거나(pending), 그린 본문을 넣거나(ready), 못 그렸다고(failed) 알린다 */
  step(file: HTMLElement, key: string, pr: PrRef, path: string): LocalStep {
    const entry = this.entries.get(key);
    if (!entry) {
      this.entries.set(key, { state: 'pending' });
      this.queue = this.queue.then(() =>
        this.render(pr, path).then(
          (html) => void this.entries.set(key, { state: 'ready', html }),
          (error: unknown) => {
            console.warn(LOG, path, error);
            this.entries.set(key, { state: 'failed' });
          },
        ).finally(this.onSettled),
      );
      return 'pending';
    }
    if (entry.state === 'pending') return 'pending';
    if (entry.state === 'failed') {
      this.entries.delete(key); // 사람이 렌더링을 다시 고르면 한 번 더 해 본다(autorich가 localFailed로 막는다)
      return 'failed';
    }
    return insertLocalBody(file, entry.html) ? 'ready' : 'pending';
  }
}

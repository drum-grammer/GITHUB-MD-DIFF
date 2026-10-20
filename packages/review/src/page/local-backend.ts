// 확장 CommentController의 로컬 백엔드 — 줄은 엔진이 잎마다 단 data-mdc-new/old로 읽고(원문을 다시 맞추지 않는다), 코멘트는 초안 API로
import type { CommentBackend, CommentState } from '../../../../src/comment-controller';
import type { BlockTarget } from '../../../../src/dom-blocks';
import { t } from '../../../../src/i18n';
import { COMMENT_BLOCK, MDF_ATTR, REMOVED_BLOCK } from '../../../../src/prose-markup';
import type { PostMode, ReviewComment } from '../../../../src/types';
import type { Badge, ThreadsPayload } from '../api-types';
import type { Api } from './api';

const RANGE = /^(\d+)-(\d+)$/;

/** 블록 → 원문 줄. 지운 블록(del·.removed 안)은 옛 쪽(left), 나머지는 새 쪽(right) — 확장 domBlocks(dom-blocks.ts:66)와 같은 규칙 */
export function mappingFromAttributes(body: HTMLElement): Map<HTMLElement, BlockTarget> {
  const map = new Map<HTMLElement, BlockTarget>();
  for (const el of body.querySelectorAll<HTMLElement>(COMMENT_BLOCK)) {
    if (el.closest(`[${MDF_ATTR}]`)) continue; // 확장이 만든 것(합친 표의 사본 등) — 합친 행은 originRow로 원래 행을 찾는다
    if (el.closest('.sr-only')) continue;
    const removed = el.closest(REMOVED_BLOCK);
    const side = removed && body.contains(removed) ? 'left' : 'right';
    const m = RANGE.exec(el.getAttribute(side === 'left' ? 'data-mdc-old' : 'data-mdc-new') ?? '');
    if (m) map.set(el, { side, start: Number(m[1]), end: Number(m[2]) });
  }
  return map;
}

export interface LocalBackendOptions {
  api: Api;
  path: string;
  /** 지금 화면의 렌더 판 — 초안의 줄 번호가 이 판 기준이다 */
  rev(): string;
  /** 새 쪽 원문(제안 버튼이 원래 줄을 미리 채운다) */
  newText(): string | null;
  /** 스레드 id → 배지. 페이지가 스레드 상자에 "Sent"·"Check position"을 붙인다 */
  badges: Map<string, Badge>;
  /** 초안이 바뀌었다(보내기 버튼 수를 고친다) */
  onChange(): void;
}

export class LocalBackend implements CommentBackend {
  /** 작업 트리 모드 — "Add comment" 버튼 하나, 아바타 없음(스펙 §5-6) */
  readonly form = { buttons: 'local' as const, showAvatar: false, singleLabel: t('reviewAddComment') };

  constructor(private readonly o: LocalBackendOptions) {}

  async load(): Promise<CommentState> {
    const data = await this.o.api<ThreadsPayload>('GET', `/api/threads?path=${encodeURIComponent(this.o.path)}`);
    for (const [id, badge] of Object.entries(data.badges)) this.o.badges.set(id, badge);
    return { threads: data.threads, pendingReview: false };
  }

  async mapping(body: HTMLElement): Promise<Map<HTMLElement, BlockTarget>> {
    return mappingFromAttributes(body);
  }

  /** 제안 버튼 — 코멘트한 블록의 새 쪽 원문 줄 전체(GitHub처럼 그 줄들을 통째로 바꾸자는 뜻). 지운 쪽에는 없다 */
  suggestion(span: BlockTarget): string | undefined {
    const text = this.o.newText();
    if (span.side !== 'right' || text === null) return undefined;
    const rows = text.replace(/\r\n?/g, '\n').split('\n').slice(span.start - 1, span.end);
    return rows.length ? rows.join('\n') : undefined;
  }

  async post(span: BlockTarget, text: string, _mode: PostMode): Promise<void> {
    await this.o.api('POST', '/api/drafts', { rev: this.o.rev(), path: this.o.path, side: span.side, start: span.start, end: span.end, body: text });
    this.o.onChange();
  }

  async edit(comment: ReviewComment, text: string): Promise<void> {
    await this.o.api('PATCH', `/api/drafts/${encodeURIComponent(comment.id)}`, { body: text });
    this.o.onChange();
  }

  async remove(comment: ReviewComment): Promise<void> {
    await this.o.api('DELETE', `/api/drafts/${encodeURIComponent(comment.id)}`);
    this.o.onChange();
  }

  async preview(text: string): Promise<string> {
    return (await this.o.api<{ html: string }>('POST', '/api/preview', { text })).html;
  }
}

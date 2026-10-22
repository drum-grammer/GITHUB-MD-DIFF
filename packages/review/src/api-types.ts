// 서버 ↔ 페이지 API의 모양 — session.ts가 만들고 page/*가 읽는다
import type { ReviewThread } from '../../../src/types';

export type ViewKind = 'merge-base' | 'since-last';

/** 화면 문구 키(locales/en.json)와 치환값 — 서버는 문구를 모른다 */
export interface Notice {
  key: string;
  subs?: string[];
}

export interface FilePayload {
  path: string;
  oldPath?: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  /** 엔진이 정화하고 표기를 붙인 `.prose-diff .markdown-body` 안쪽 HTML */
  html: string;
  /** 새 쪽 원문 — 제안 버튼이 원래 줄을 미리 채운다 */
  newText: string | null;
  notices: Array<{ kind: string }>;
  /** 엔진이 이 파일에서 실패했다(다른 파일은 그대로 그린다) */
  error?: string;
}

export interface OffViewItem {
  id: string;
  path: string;
  lines: string;
  quote: string;
}

export interface EarlierItem {
  round: number;
  path: string;
  lines: string;
  quote: string;
}

export interface ViewPayload {
  rev: string;
  view: ViewKind;
  /** "1a2b3c4 (merge-base origin/main)" 또는 "review render r7k2q9" */
  baseText: string;
  /** 라운드나 mark가 하나라도 있다 — 기준 고르기를 켠다 */
  sinceLastAvailable: boolean;
  notices: Notice[];
  files: FilePayload[];
  drafts: number;
  /** 이 보기에 없는 파일에 단 초안(지워졌거나 이름이 바뀌었거나 지난 리뷰 이후 안 바뀜) */
  offView: OffViewItem[];
  /** 다른 판에서 보낸 코멘트(페이지 위 목록으로만) */
  earlier: EarlierItem[];
  /** PR 모드의 PR(head는 7자) */
  pr?: { owner: string; repo: string; number: number; url: string; title: string; head: string };
}

export type Badge = 'sent' | 'stale';

export interface ThreadsPayload {
  threads: ReviewThread[];
  /** 스레드 id → 배지(보냄·위치 확인 필요) */
  badges: Record<string, Badge>;
  /** PR 모드 — 숨긴 낡은(outdated) 스레드 수 */
  hidden?: number;
  /** PR 모드 — GitHub 스레드 id → 남의 코멘트 수(에이전트에게 보내기에 넣을지 고르는 상자) */
  github?: Record<string, { others: number }>;
  /** PR 모드 — GitHub 스레드를 못 읽은 이유(내 초안은 그대로 보인다) */
  githubError?: string;
}

export interface PollPayload {
  /** 그린 뒤 작업 트리 md가 바뀌었다 */
  changed: boolean;
  /** 이 판보다 새 판이 있다(기준이 바뀜·다른 탭이 다시 그림) */
  superseded: boolean;
}

export interface SendPayload {
  round: number;
  comments: number;
}

export interface DraftInput {
  rev: string;
  path: string;
  /** 확장 BlockTarget의 쪽 — left = 옛 쪽, right = 새 쪽 */
  side: 'left' | 'right';
  start: number;
  end: number;
  body: string;
  /** PR 모드의 답글 — GitHub 스레드 id */
  replyTo?: string;
}

/** 보류 중 리뷰에 넣기의 결과 — 실패한 것만 남는다 */
export interface PushPayload {
  added: number;
  failed: Array<{ id: string; path: string; lines: string; error: string }>;
  /** 리뷰를 제출할 GitHub 주소 */
  url: string;
}

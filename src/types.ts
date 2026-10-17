/**
 * 코멘트·스레드의 공용 타입 — 확장(GitHub 내부 요청, github-api.ts)과 로컬 리뷰 페이지가 같이 쓴다.
 * 요청 코드를 모르는 화면 모듈(comment-ui·dom-blocks·comment-controller)은 여기서만 타입을 가져온다
 */

/** left = 원래 파일(지운 쪽), right = 새 파일 */
export type Side = 'left' | 'right';

/** single = 바로 올리기, review = 보류 중인 리뷰에 넣기(없으면 리뷰 시작) */
export type PostMode = 'single' | 'review';

export interface ReviewComment {
  id: string;
  author: string;
  body: string;
  bodyHTML: string;
  url: string;
  pending: boolean;
  /** 고칠 때 함께 보내는 본문 버전(동시에 고친 것을 GitHub가 거른다) */
  bodyVersion: string;
  /** 내가 고치거나 지울 수 있는가(GitHub가 알려 준다 — 보통 내가 쓴 코멘트) */
  canEdit: boolean;
  canDelete: boolean;
}

export interface ReviewThread {
  id: string;
  /** line = 줄(범위)에 단 것, file = 파일 전체에 단 것(줄 없음 — start·end는 0) */
  subject: 'line' | 'file';
  side: Side;
  /** 1부터, 끝 포함 */
  start: number;
  end: number;
  resolved: boolean;
  canReply: boolean;
  comments: ReviewComment[];
}

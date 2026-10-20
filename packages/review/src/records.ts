// 저장 폴더에 남는 기록의 모양(스펙 §5-4). 줄은 1부터, 끝 포함
export type SourceSide = 'old' | 'new';

/** 렌더 판 — 서버가 diff를 그릴 때마다 하나. 코멘트의 줄 번호와 인용은 이 판 기준이다 */
export interface RenderRecord {
  /** 'r' + 5자(base36) */
  id: string;
  createdAt: string;
  mode: 'worktree';
  /** 그릴 때의 분기점 OID(첫 커밋 전이면 빈 트리) */
  baseOid: string;
  baseLabel: string;
  /** 화면이 무엇을 견줬나 — 분기점, 또는 지난 리뷰 판 */
  view: { kind: 'merge-base' } | { kind: 'since-last'; from: string };
  /**
   * 그 순간 분기점과 다른 **모든** md의 작업 트리 원문(지운 경로는 null). 화면에 그리지 않은 파일도 담는다 —
   * 다음 --since-last 라운드의 옛 쪽이 이것이기 때문이다
   */
  files: Record<string, string | null>;
  /** 화면에 그린 파일(순서대로) */
  shown: string[];
}

/** 아직 보내지 않은 코멘트 — 다시 그리기·새로고침에도 남는다 */
export interface Draft {
  id: string;
  /** 줄 번호가 기준으로 삼는 렌더 판 */
  rev: string;
  path: string;
  side: SourceSide;
  start: number;
  end: number;
  /** 사람이 쓴 글 그대로(제안 블록 포함) */
  body: string;
  kind: string;
  headingPath: string[];
  quote: string;
  quoteSanitized: string;
  createdAt: string;
  updatedAt: string;
  /** 다시 그린 판에서 그 줄의 원문이 달라졌다 — 사람이 위치를 확인해야 한다 */
  moved?: true;
}

/** 보낸 코멘트 한 건 — 스펙 §5-4의 JSON 모양 그대로 */
export interface StoredComment {
  /** 'c' + 라운드 안 번호(넘기기 형식의 "### 2 ·") */
  id: string;
  round: number;
  rev: string;
  path: string;
  side: SourceSide;
  start: number;
  end: number;
  kind: string;
  headingPath: string[];
  /** 'you' 또는 '@login'(PR 모드의 남) */
  author: string;
  /** 원문 줄 그대로 */
  quote: string;
  /** 보이지 않는 내용을 ⟦…⟧ 표식으로 바꾼 판 */
  quoteSanitized: string;
  /** 제안 블록을 뺀 코멘트 마크다운 */
  body: string;
  suggestion: string | null;
  /** 분기점 OID 또는 지난 리뷰 판 id */
  base: string;
  mode: 'worktree';
  createdAt: string;
}

export type RoundBase = { kind: 'merge-base'; oid: string; label: string } | { kind: 'review-render'; rev: string };

/** "에이전트에게 보내기" 1회 */
export interface Round {
  round: number;
  createdAt: string;
  /** 사람이 본 렌더 판 */
  rev: string;
  mode: 'worktree';
  base: RoundBase;
  /** 그린 뒤 보내기 전에 파일이 바뀌었다 */
  changedAfterRender: boolean;
  /** 리뷰한(화면에 그린) 파일 */
  files: string[];
  comments: StoredComment[];
  /** PR 모드에서 사람이 빼낸 남의 코멘트 수(작업 트리 모드는 0) */
  excluded?: number;
}

export interface Mark {
  rev: string;
  at: string;
}

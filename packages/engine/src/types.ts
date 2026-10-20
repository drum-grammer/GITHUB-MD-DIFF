/** 엔진 모델 — IDE 연결이 화면 없이 쓰는 계약이라 여기서 고정한다. 줄은 1부터, 끝 포함(확장 SourceBlock과 같은 규칙) */
import type { RowOp } from '../../../src/table-diff';

export type { RowOp };

export type Range = { start: number; end: number };

/** 잎 종류 — 확장과 같은 다섯 + 각주·머리말 분리 + 잎을 내지 않는 토큰의 의사 잎 넷 */
export type Kind = 'heading' | 'paragraph' | 'item' | 'row' | 'code' | 'footnote' | 'meta' | 'hr' | 'html' | 'math' | 'definition';

export interface Leaf {
  kind: Kind;
  old?: Range;
  new?: Range;
  /** 그 잎보다 앞에 있는 제목들의 경로(바깥 제목부터) */
  headingPath: string[];
}

/** 글 조각 — 태그 경계를 넘지 않는다(서식 태그 없이 글과 원자 요소만) */
export type WordOp = { op: 'same' | 'ins' | 'del'; html: string };

export type LeafOp =
  | { op: 'same'; leaf: Leaf; sourceOnly?: true }
  | { op: 'changed'; leaf: Leaf; words?: WordOp[]; wholeBlock?: true; invisible?: true }
  | { op: 'added'; leaf: Leaf }
  | { op: 'removed'; leaf: Leaf };

export interface TopBlock {
  op: 'same' | 'changed' | 'added' | 'removed';
  /** 렌더링 파서의 최상위 토큰 종류. 엔진이 만든 것은 front_matter·definition·footnote_block */
  tokenType: string;
  old?: Range;
  new?: Range;
  leaves: LeafOp[];
  /** 표가 바뀌었을 때 본문 행 비교(확장 table-diff.ts 그대로) */
  rows?: RowOp[];
  sourceOnly?: true;
  wholeBlock?: true;
}

export interface FileNotice {
  kind: 'source-only' | 'line-endings' | 'whitespace' | 'unreferenced-footnote';
  old?: Range;
  new?: Range;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  oldText: string | null;
  newText: string | null;
  blocks: TopBlock[];
  notices: FileNotice[];
}

export interface DiffOptions {
  /** 기준점 사이 틈이 이 칸 수를 넘으면 비슷한 잎을 찾지 않는다(확장 기본 20,000보다 크게) */
  gapCells?: number;
  /** 남은 잎 수의 곱이 이를 넘으면 앞으로만 찾는다 */
  maxCells?: number;
  /** 바뀐 낱말 비율이 이를 넘으면 단어 표시 없이 옛·새 블록을 통째로 낸다 */
  wholeBlockRatio?: number;
}

export interface RenderContext {
  /** 렌더 판 id — 본문 최상위의 `data-mdc-rev`와 잎마다 Codex 주석 메타데이터(`rev`)에 들어간다 */
  rev: string;
  /** 저장소 상대 경로의 이미지 → 서버가 발급한 id. null이면 그 이미지는 막는다(src를 비우고 data-mdc-blocked) */
  imageId(side: 'old' | 'new', repoPath: string): string | null;
  /** 기본 false. false면 http(s) 이미지는 src를 비우고 data-mdc-remote에 주소를 둔다 */
  allowRemoteImages?: boolean;
}

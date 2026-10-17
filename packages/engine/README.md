# @markdown-diff-cat/engine — 로컬 렌더링 마크다운 diff 엔진

> 비공개 워크스페이스 패키지(`private: true`, npm에 내지 않음). 설계·진행·남은 일: [docs/local-review](../../docs/local-review/README.md)

옛·새 마크다운 원문에서 블록 diff 모델(`FileDiff`)과 GitHub rich diff와 같은 표기의 HTML을 만든다. 확장 화면 모듈(`applyBody`·접기·표 합치기·이동·코멘트)이 그 HTML을 GitHub 화면과 똑같이 받는다. 바깥으로 요청하지 않는다.

## API

```ts
import { diffMarkdown, renderProseDiff, renderMarkdown } from '@markdown-diff-cat/engine';

const diff = diffMarkdown({ oldText, newText, path: 'docs/guide.md' });   // FileDiff — JSON으로 주고받을 수 있다
const html = renderProseDiff(diff, {
  rev: 'r1',                                   // 본문 최상위 요소에 data-mdc-rev
  imageId: (side, repoPath) => serverIssuedId(side, repoPath), // 저장소 안 이미지 → /file/<id>, null이면 막음
  allowRemoteImages: false,                    // 기본: 바깥 이미지는 src를 비우고 data-mdc-remote에
});                                            // `.prose-diff .markdown-body` 안쪽 HTML
const preview = renderMarkdown(commentText);   // 코멘트 미리보기(정화, diff 표시 없음)
```

`null`은 추가된 파일(`oldText`)·지운 파일(`newText`)이다. 줄은 1부터, 끝 포함이다. 모델 타입은 [src/types.ts](src/types.ts).

기본값(M1 끝 결정): 단어 표시 기준 `DEFAULT_WHOLE_BLOCK_RATIO = 0.45`, 짝짓기 한도 `ENGINE_GAP_CELLS = 250_000`·`ENGINE_MAX_CELLS = 4_000_000` — [test/defaults.test.ts](test/defaults.test.ts)가 고정한다.

## 파일

| 파일 | 맡은 일 |
|---|---|
| [src/side.ts](src/side.ts) | 한 쪽 원문 → 최상위 블록·잎·의사 잎·각주(파서 둘을 줄 범위로) |
| [src/markdown.ts](src/markdown.ts) | 렌더링 파서 — markdown-it 15 + 할 일·알림·각주·KaTeX·이모지, GitHub 모양 표·제목 앵커·Mermaid 자리표시 |
| [src/sanitize.ts](src/sanitize.ts) · [src/safe-url.ts](src/safe-url.ts) | 원문 HTML 정화(DOMPurify + jsdom)와 주소 규칙 |
| [src/pair.ts](src/pair.ts) | 옛 ↔ 새 잎 짝짓기(확장 `alignBlocks` + 제목 경계·같은 개수 1:1·대각선 띠) |
| [src/keys.ts](src/keys.ts) | 렌더링 비교 키·보이는 글·보이지 않는 글자·숨은 부분(주석·주소) |
| [src/words.ts](src/words.ts) | 블록 안 단어 비교(`Intl.Segmenter`, 원자 요소, 태그 경계) |
| [src/lines.ts](src/lines.ts) | 원문 줄 diff·줄 끝 판정·보이지 않는 글자 표식 |
| [src/diff.ts](src/diff.ts) | 분류·최상위 묶기·지운 잎 자리·각주·"원문만 바뀜" 막대·파일 알림 → `FileDiff` + 그리기 계획 |
| [src/emit.ts](src/emit.ts) | GitHub 표기 HTML 조립·줄 속성·이미지 |
| [build/bundle.mjs](build/bundle.mjs) | 엔진을 Node 22 ESM 한 파일로(jsdom 실행 중 파일을 번들 안에서) — 패리티 스크립트와 M2 CLI가 쓴다 |
| [parity/](parity/) | GitHub 패리티 비교·보고서, [받아들인 차이](parity/KNOWN-DIFFERENCES.md) |

## 시험

```bash
pnpm vitest run --project engine   # 엔진 시험 — 불변식(hunk 표시·줄 속성·파서 고정점·확장 DOM 모듈 재사용) 포함
pnpm parity                        # 고정 자료와 GitHub 패리티(네트워크 없음) → .scratch/parity/report.md
pnpm parity:capture                # 공개 testbed PR의 rich diff를 읽기만 해서 고정 자료로(로그인 테스트 프로필)
pnpm parity:setup                  # testbed parity/ 브랜치·초안 PR — 공개 저장소에 쓰므로 --confirm이 있어야 쓴다
```

시험 문서는 확장 testbed처럼 지어낸 제품(Lantern) 글만 쓴다. 보이지 않는 글자는 코드·시험에 `\u200B`처럼 escape로 쓴다.

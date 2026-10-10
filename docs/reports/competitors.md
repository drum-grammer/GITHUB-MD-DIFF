# 비슷한 확장 비교 — GitHub PR 마크다운 리뷰

> 2026-10-08 조사, 2026-10-10 우리 쪽 상태 갱신 · [로드맵](../../ROADMAP.md) · [README · Research and test reports](../../README.md#research-and-test-reports)
>
> **English summary** — We compared eight Chrome Web Store extensions found by searching "markdown diff" (2026-10-08). The market is small and new: the most used, Markdown PR, had 241 users, the rest 3 to 39, and most appeared in 2026. Three of them comment from the rendered view (Markdown PR, Mihiraki, Marginalia), all through GitHub's internal requests rather than a public API. Only Markdown Diff Cat folds unchanged sections and merges changed table rows into one table, and it keeps GitHub's own rendering, so code highlighting, math, and Mermaid look the same as on GitHub. The gaps we found then were commenting in the rendered view (done in 1.1.0), change and thread navigation (1.2.0), and editing, deleting, and previewing comments (1.3.0). Side-by-side view, store ratings, and refreshed store images remain.

크롬 웹 스토어에서 "markdown diff"로 검색해 나온 확장 중 Git 관련 8개를 Markdown Diff Cat과 견줬다. 숫자는 2026-10-08 각 스토어 상세 페이지에서 읽었다. 공개 소스 두 개(Markdown PR·Mihiraki)는 코드를 읽어 코멘트 구현을 확인했다.

## 한눈에 보기

| 확장 | 대상 | 사용자(10-08) | 하는 일 | 렌더링 | 렌더링 보기에서 코멘트 | 소스 |
|---|---|---|---|---|---|---|
| [Markdown PR](https://chromewebstore.google.com/detail/bdkcmcdfnhonfcpdgcmemkpcmnhnhemj) | GitHub | 241 | 코멘트·답글·해결·편집·삭제, 스레드 사이드바, 바뀐 블록 목록, 제목별 접기, 단축키 | GitHub 렌더링 위에 덧붙임 | 글자 맞춤 + 줄 번호 직접 고치기(적중률 약 12%라고 스스로 적음) | [MIT](https://github.com/chienyuanchang/rich-diff-comments) |
| [Mihiraki](https://chromewebstore.google.com/detail/aonhhghpakchakdddehflcpdobnhofij) | GitHub | 4 | 좌우 나란히·한 줄 보기, 블록 안 단어 강조, 코멘트·스레드 | 자체 렌더링(markdown-it) | 자체 파서의 줄 번호 | [MIT](https://github.com/KinjiKawaguchi/mihiraki) |
| [Marginalia](https://chromewebstore.google.com/detail/lglfgkfllbjaoadkdjaflbbaljhdjopi) | GitHub | 3 | 블록에서 원문으로 점프, 인라인 코멘트 | GitHub 렌더링 | 휴리스틱(근처 줄에 달릴 수 있다고 스스로 적음) | 없음 |
| [Markdown Review for GitHub](https://chromewebstore.google.com/detail/jdjldokaikacojobiofobcgnifghajfg) | GitHub | 15 | PR을 외부 리뷰 화면으로 여는 버튼, 섹션별 리뷰 추적 | 외부 서비스 | 외부 서비스에서(전체 기능 유료) | 없음 |
| [Markdown Diff Renderer](https://chromewebstore.google.com/detail/lpcmmmmkobnhhfjddakpfhmgjbdnnamh) | GitHub·Bitbucket | 6 | 파일마다 렌더링 토글 | 자체 렌더링 | — | 없음 |
| [Auto Rich Diff for GitHub](https://chromewebstore.google.com/detail/kefpmlmdgmlpemadndmbjfmgibpndeka) | GitHub | 10 | md 파일을 렌더링 보기로 자동 전환 | GitHub 렌더링 | — | [공개](https://github.com/rerelurelu/auto-rich-diff-for-github) |
| [GitHub Diff Switch](https://chromewebstore.google.com/detail/elcmofppmodpnhggkobmencgoddpnjeo) | GitHub | 10 | 모든 파일을 한 번에 렌더링·원문으로 | GitHub 렌더링 | — | 없음 |
| [Bitbucket Rich Diffs](https://chromewebstore.google.com/detail/iblibjooindpmlpgagplcnmjkcpoaecm) | Bitbucket Cloud | 39 | 원래 diff·렌더링·좌우 세 가지 보기 | 자체 렌더링 | — | [MIT](https://github.com/thelinuxer/bitbucket-rich-diffs) |
| **Markdown Diff Cat** | GitHub | — | 자동 렌더링, 바뀌지 않은 구간 접기, 표는 바뀐 행만, 변경·스레드 이동, 코멘트·답글·해결·편집·삭제·미리보기 | GitHub 렌더링에서 덜어냄 | 원문을 파싱해 블록과 정렬 — 공개 PR 300개에서 렌더링 블록의 99.7%가 원문 줄에 연결 | MIT |

## Markdown Diff Cat만 하는 것

1. **바뀐 곳만 남긴다** — 바뀌지 않은 구간을 자동으로 접고 숨긴 블록 수와 마지막 제목을 보여 준다. 다른 확장은 전부 보여 주거나 사람이 제목별로 접는다
2. **표는 바뀐 행만** — 행 하나만 바뀌어도 GitHub가 옛 표·새 표를 통째로 보여 주는 문제를 푸는 것은 우리뿐이다
3. **GitHub 렌더링 그대로** — 코드 강조·수식·Mermaid·상대 경로 이미지가 GitHub와 같다. 자체 렌더링 방식의 빈틈이 없다
4. **로그아웃·옛 화면도 동작** — 로그아웃 사용자가 보는 옛 "Files changed"(`/files`)에서도 접기·표 합치기가 된다
5. **가벼운 권한** — `storage`와 `https://github.com/*`뿐이고 토큰을 쓰지 않는다. 코멘트도 이미 있는 GitHub 세션으로만

## 부족했던 것과 지금

| 부족했던 것(10-08) | 누가 했나 | 지금 |
|---|---|---|
| 렌더링 보기에서 코멘트 | Markdown PR · Mihiraki · Marginalia | **1.1.0**에서 함 — 지운 블록은 원래 파일 쪽 줄에 단다 |
| 변경·스레드 탐색(다음 변경·다음 스레드) | Markdown PR | **1.2.0**에서 함 — 파일 툴바 요약과 `]` `[` `}` `{` |
| 코멘트 편집·삭제·미리보기 | Markdown PR · Mihiraki | **1.3.0**에서 함 — 파일 전체 코멘트 표시도 |
| 코멘트 상자가 GitHub와 달라 보임 | — | **1.4.0**(초안 [#31](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/31)) — 서식 도구 막대·`R13` 머리글 |
| 올린 뒤 GitHub 화면 즉시 반영 | Mihiraki | 남음 — GitHub 내부 상태를 건드려야 해서 깨지기 쉽다 |
| 좌우 나란히 비교 | Mihiraki · Bitbucket Rich Diffs | 남음(선택) — GitHub 렌더링을 버려야 한다 |
| 스토어 사용자·평점, 등록물에 새 기능이 안 보임 | — | 남음 — 다음 검토 신청 때 이미지 갱신 |
| Bitbucket·Azure DevOps | Bitbucket Rich Diffs | 수요 확인 전 |

다음 순서는 [로드맵](../../ROADMAP.md)에 있다.

## 기술 메모

- 코멘트하는 세 확장 모두 공식 API가 아니라 GitHub "Files changed" 화면의 내부 요청(Marginalia는 api.github.com)을 쓴다. Markdown PR은 첫 버전(2026-05-18)부터 `page_data/create_review_comment`를 썼고 2026-10-08에도 그대로 동작했다 — 약 4.7개월 유지
- Markdown Diff Cat이 기대는 요청과 대비(바뀌면 코멘트만 스스로 끈다)는 `src/github-api.ts`에 모여 있다. 요청 목록은 [1.3.0 테스트 보고서 §4](v1.3.0-testing.md#4-찾은-것과-고친-것--130)
- 새 "Files changed" 화면은 2025-11 공개 미리보기 → [2026-01-22 기본값](https://github.blog/changelog/2026-01-22-improved-pull-request-files-changed-page-on-by-default) → 2026-03까지 2~4주마다 바뀌었다(GitHub 변경 기록). 2026-04 이후로는 "Files changed" 제목 공지를 찾지 못했다(⚠️ 검색 결과 기준). 실제로 깨진 날짜는 `pnpm canary` 기록으로 잰다
- 코멘트 요청 모양을 처음 정리한 것은 [Markdown PR](https://github.com/chienyuanchang/rich-diff-comments)과 [Mihiraki](https://github.com/KinjiKawaguchi/mihiraki)다(둘 다 MIT, [README · Thanks](../../README.md#thanks))

# 로드맵 — 어디까지 왔고 다음은 무엇인가

> 최종 확인 2026-10-14 · [README](README.md) · 조사·테스트 기록: [README · Research and test reports](README.md#research-and-test-reports) · 다음 제출 노트: [UNRELEASED](docs/releases/UNRELEASED.md)
>
> **English summary** — The Chrome Web Store has 1.5.0 (published 2026-10-14), but it does nothing on the signed-in "Files changed" page: GitHub renamed its CSS module classes that day (`Diff-module__diff__hash` → `diff__hash`) and the extension stopped without a warning. 1.5.1 fixes it — it finds files by their anchor id and page structure first, accepts both class formats, warns when it cannot read any file, and the tests, canary and scripts share one set of selectors. 1.5.1 is in store review (submitted 2026-10-14); next, make the canary actually run every day. How to handle the next GitHub change: [docs/runbooks/github-ui-change.md](docs/runbooks/github-ui-change.md). This file is the place to pick up the work without any other context: read "Where things stand", then "Next", then "How to pick up".

새 세션이나 새 기여자가 이 문서 하나만 읽고 이어서 일할 수 있게 쓴다. 버전을 병합하거나 결정이 바뀌면 **지금 어디에 있나**와 **버전 연표**를 같은 PR에서 고친다.

## 지금 어디에 있나 (2026-10-14)

| | 상태 |
|---|---|
| 크롬 웹 스토어(공개) | **1.5.0** — 2026-10-13 제출, 2026-10-14 게시 확인(`pnpm release status`). **로그인한 사용자의 "Files changed"에서 동작하지 않는다** — 같은 날 GitHub가 화면의 클래스 이름 형식을 바꿨다([보고서](docs/reports/v1.5.1-github-class-names.md)). 로그아웃 화면은 정상 |
| `main` | **1.5.1**(2026-10-14, [#44](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/44)) |
| 진행 중 | **1.5.1 심사 중** — 2026-10-14 API로 업로드·제출(`0873956`, zip SHA-256 `fa442a56…`, PENDING_REVIEW). 새 클래스 이름 형식 대응(파일 앵커 id·구조가 1순위, 두 형식 모두), 파일을 못 읽으면 경고, 시험·canary·스크립트 공통 선택자, canary 클래스 형식 점검·`pnpm canary:status`. 노트 [v1.5.1](docs/releases/v1.5.1.md) |
| 관리자 크롬 | 스토어판 1.5.0(로그인 화면에서 멈춤). 1.5.1이 게시될 때까지 `pnpm dev:chrome`으로 고친 빌드를 쓴다 |
| 스토어 검토 신청 | 1.5.1 제출함(2026-10-14, 관리자 요청) — 게시되면 `pnpm release finish --confirm 1.5.1` |
| 주간 카나리 | 상시 켜 둔 맥의 예약이 **한 번도 돌지 않았다**(그 맥의 화면 로그인·알림 토큰 대기). 그래서 이번 변경을 사용자가 먼저 겪었다. 2026-10-14 관리자 맥북에서 손으로 돌림: 1.5.0 깨짐 3/7 → 1.5.1 정상 9/9 |

## 다음 할 일 (순서대로)

1. **1.5.1 게시 확인** — `pnpm release status`(심사 며칠). 게시되면 `pnpm release finish --confirm 1.5.1`(태그·GitHub Release를 **Latest**로) · v1.5.0 GitHub Release는 **pre-release로 둔다**(로그인 화면에서 멈춘 판 — 2026-10-14 관리자 결정) · store/README 제출 기록 상태 · 쓰지 않은 1.1.1 초안 Release 정리는 관리자가 정한다
2. **canary가 매일 실제로 돌게** — 상시 켠 맥의 화면 로그인 → 예약 확인. `pnpm canary:status`(2일 넘게 안 돌았거나 깨졌으면 종료 코드 1)를 정기 점검에 붙인다. 클래스 형식이 또 바뀌면 "클래스 이름 형식" 점검이 사용자보다 먼저 깨진다
3. **로컬 사용 점검 — 2026-10-16** — 1주 동안 쓰며 나온 불편·오류를 1.5.x로 고친다(PATCH)
4. **개선 후보**(수요·여유에 따라, 위에서부터)

   | 후보 | 왜·근거 | 무게 |
   |---|---|---|
   | 큰 PR 가상화 모드 E2E | GitHub가 화면 밖 파일을 내리는 모드(`virtualizeDiffEntries`)를 아직 E2E로 안 본다 · [비슷한 확장 비교](docs/reports/competitors.md) 제안 5 | 작다 |
   | 남의 코멘트에 편집·삭제가 안 보이는지 | 테스트 저장소는 계정 하나라 모든 코멘트가 내 것 — 두 번째 테스트 계정이 필요 · [1.3.0 보고서 §7](docs/reports/v1.3.0-testing.md#7-다음에) | 작다 |
   | 올린 뒤 GitHub 원문 보기·"Review changes" 개수 즉시 반영 | 지금은 새로고침해야 GitHub 쪽에 보인다. GitHub 내부 상태(React)를 건드려야 해서 깨지기 쉽다 | 중간 |
   | 언어 설정(영어·한국어) | 1.5.0부터 GitHub 화면에 맞춰 영어로 통일했다(2026-10-11 관리자 결정). 한국어 문구(`_locales/ko`)는 그대로 있으니, 팝업이나 옵션 페이지에 언어 고르기를 두고 `src/i18n.ts`가 고른 파일을 읽게 한다 | 작다 |
   | AI 기능·지속 가능성 검토안 | [docs/proposals/2026-10-12-ai-next.ko.md](docs/proposals/2026-10-12-ai-next.ko.md) — 규칙 기반 문서 렌즈(1.6)·봇 코멘트 배지(1.7)·에이전트에게 넘기기(1.8) 후보, 확장 안 LLM·BYOK·기능 잠금은 버림 | 문서 |
   | 코멘트 파일 첨부 | GitHub 내부 업로드 요청이 필요하다(#31에서 뺐다) | 중간 |
   | 커밋·compare 화면 | 지금은 PR "Files changed"만 | 중간 |
   | 좌우 비교 보기 | Mihiraki·Bitbucket Rich Diffs가 한다. GitHub 렌더링을 버려야 해서 지금의 강점과 부딪친다 | 크다 |
   | Bitbucket·Azure DevOps | 수요 확인 전 | 크다 |

5. **늘 하는 일**
   - 주 1회 `pnpm canary`(상시 켜 둔 맥) — 깨지면 `canary` 라벨 이슈가 열린다(`.github/workflows/canary-report.yml`)
   - GitHub 화면이 바뀌면 PATCH. 가정은 `src/selectors.ts`(화면)·`src/github-api.ts`(요청) 두 파일에만 있고, 시험·스크립트도 `GITHUB_CSS`로 같은 가정을 쓴다. 알아채기·고치기·내보내기 순서는 [runbook](docs/runbooks/github-ui-change.md)
   - `pnpm canary:status` — 점검이 멈춘 것도 알아야 한다(2026-10-11~14 예약이 한 번도 돌지 않았다)

## 버전 연표

| 버전 | 날짜 | 무엇 | PR | 상태 | 기록 |
|---|---|---|---|---|---|
| 0.1 | 2026-10-06 | PR 마크다운을 바뀐 부분만 렌더링 | #1–#2 | 개발자 모드(태그 없음) | |
| 1.0.0 | 2026-10-07 | 자동 렌더링 · 바뀌지 않은 구간 접기 · 표는 바뀐 행만 · 로그아웃 옛 화면 · 아이콘 | #3–#10 | **스토어 게시**(2026-10-08) | [Release](https://github.com/drum-grammer/GITHUB-MD-DIFF/releases/tag/v1.0.0) |
| 1.1.0 | 2026-10-07 | 렌더링 보기에서 바로 코멘트(+, 범위, 스레드·답글·해결) | #11–#21 | 심사 제출 후 취소([#22](https://github.com/drum-grammer/GITHUB-MD-DIFF/issues/22) 오탐) | |
| 1.1.1 | 2026-10-08 | #22 수정 · 공개 PR 300개 탐험으로 11건 · 확장 CPU −81% · 각주 · 테스트 저장소 하네스 · `dev:chrome`·`release` | #23–#28 | 내지 않음(다음 제출에 포함) | [노트](docs/releases/v1.1.1.md) · [검증](docs/reports/v1.1.1-verification.md) · [테스트 저장소](docs/reports/v1.1.1-testbed.md) |
| 1.2.0 | 2026-10-09 | 변경 탐색 — 파일 툴바 요약, `]` `[` `}` `{` 이동 | [#29](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/29) | `main` | |
| 1.3.0 | 2026-10-09 | 파일 전체 코멘트 · 내 코멘트 편집·삭제 · 미리보기 · 테스트 저장소 v2(화면 모양 5가지) · 검증 등급 | [#30](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/30) | `main` | [테스트](docs/reports/v1.3.0-testing.md) |
| 1.4.0 | 2026-10-11 | 코멘트 상자를 GitHub 상자 모양으로(아바타·`R13` 머리글·서식 도구 막대·빈 글이면 버튼 끔) · 제안(suggestion) 버튼 · 목록 종류 바꾸기 | [#31](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/31) | `main` | [테스트](docs/reports/v1.4.0-testing.md) |
| 1.5.0 | 2026-10-11 | 답글 상자에도 제안 버튼(GitHub 답글 상자와 같게) · 확장 문구를 영어로 통일(크롬 언어와 상관없이) | [#33](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/33) | **스토어 게시**(2026-10-14) — 로그인 화면에서 멈춤 | |
| 1.5.1 | 2026-10-14 | GitHub 클래스 이름 새 형식(`diff__해시`) 대응 — 파일 앵커 id·구조 우선, 두 형식 모두 · 파일을 못 읽으면 경고 · 시험·canary·스크립트 공통 선택자 · canary 형식 점검·`canary:status` | [#44](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/44) | 심사 중(2026-10-14 제출) | [보고서](docs/reports/v1.5.1-github-class-names.md) · [runbook](docs/runbooks/github-ui-change.md) |

버전 규칙은 [store/README · Versioning](store/README.md#versioning) — PATCH는 버그·GitHub 화면 따라가기, MINOR는 새 기능(권한 추가 없음), MAJOR는 권한·사이트 추가나 동작 변경.

## 이어받는 법

1. **받기** — `git clone` 후 `pnpm install`(pnpm 12, Node 22.18 이상)
2. **상태 보기** — 이 문서 → `gh pr list`(열린 PR) → [UNRELEASED](docs/releases/UNRELEASED.md)(아직 스토어에 없는 변경)
3. **검증** — 개발 중 `pnpm verify quick`(약 45초) · PR 병합 전 `pnpm verify pr`(약 6분) · 검토 신청 전 `pnpm verify release`(약 16–18분). `pr`·`release`는 `gh` 로그인과 테스트 프로필(`pnpm e2e:login`)이 필요하고 공개 테스트 저장소에 실제로 코멘트를 쓴다. [README · Verification tiers](README.md#verification-tiers) · [testbed/README.md](testbed/README.md)
4. **써 보기** — `pnpm dev:chrome`. 처음 한 번만 `chrome://extensions`에서 고정 폴더를 압축해제 로드하고, 그 뒤로는 GitHub 탭 새로고침 한 번이면 새 빌드로 바뀐다. [README · Install](README.md#install)
5. **새 버전을 낼 때 같은 PR에 넣을 것**
   - `static/manifest.json`·`package.json`의 `version`
   - README 기능 목록(영어·한국어 둘 다)
   - [UNRELEASED](docs/releases/UNRELEASED.md)에 사람이 읽을 변경 몇 줄
   - 테스트가 큰 버전은 보고서 `docs/reports/vX.Y.Z-testing.md`(한국어 본문 + 맨 위 영어 요약)
   - 이 문서의 **지금 어디에 있나**·**버전 연표**
6. **지킬 것**
   - 공개 저장소다. 비공개 저장소의 내용·회사·개인 정보를 코드·문서·이슈·PR에 넣지 않는다. 탐험(`pnpm explore`)은 공개 저장소만 연다
   - 고정 자료(테스트 픽스처)는 공개 저장소에서 가져오거나 손으로 만든다 — 첫 줄에 출처(`test/fixtures.test.ts`가 확인)
   - 스토어 대시보드는 사람이 입력한다. 스토어 제출·태그·GitHub Release는 관리자 확인 뒤
   - 권한(`storage` + `https://github.com/*`)을 늘리면 MAJOR다

## 조사·테스트 기록

- 요약과 보고서 목록: [README · Research and test reports](README.md#research-and-test-reports)
- 관리자용 요약 페이지(비공개 링크 — 관리자만 열린다): [Markdown Diff Cat 조사·테스트 모음](https://claude.ai/artifact/X8tNysv7MhgaKZocWzaPNx) · [1.1.1 검증 보고서](https://claude.ai/artifact/9dxHzJFADpAqSk6U4HMjT3)

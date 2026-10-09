# Testbed — 배포 전 시나리오 하네스

공개 테스트 저장소 [drum-grammer/markdown-diff-cat-testbed](https://github.com/drum-grammer/markdown-diff-cat-testbed)의 PR에서 확장을 실제로 써 본다. 코멘트를 달고, 기존 스레드를 보고, 답글을 달고, 해결하고, 내 코멘트를 고치거나 지운다. 단위·E2E 테스트가 고정된 화면을 보는 것과 달리, 이 하네스는 **GitHub에 실제로 쓰고 API로 다시 읽어** 줄 번호를 확인한다. GitHub "Files changed" 화면 모양(톱니바퀴 메뉴) 5가지에서 돈다.

보통은 검증 등급으로 돌린다(README의 Develop): `pnpm verify quick`은 `@quick` 시나리오만, `pr`은 Split에서 모든 시나리오, `release`는 화면 모양 5가지 전부를 돈다. 이 폴더만 따로 돌릴 때는 아래와 같다.

## 돌리기

```bash
pnpm testbed:setup
```

```bash
pnpm testbed
```

```bash
pnpm testbed:report --out .scratch/testbed/report.md
```

- 준비: `gh auth login`(저장소 만들기·코멘트 쓰기·지우기)과 `pnpm e2e:login`(크롬 테스트 프로필의 GitHub 로그인). Node 22.18 이상(설정 스크립트가 `.ts`를 바로 읽는다)
- `testbed:setup`은 여러 번 돌려도 같다. 저장소가 없으면 만들고, 내용 버전이 다르면 다시 밀고, 심을 스레드가 없으면 달고, 지난 실행이 남긴 코멘트를 걷는다. 결과는 `.scratch/testbed/state.json`
- `testbed`는 확장을 빌드하고 모든 프로젝트(화면 모양 5가지)를 돈다(약 11분). 하나만 돌리려면 `npx playwright test -c testbed/playwright.config.ts --project split`이나 `--grep @quick`. 결과는 `.scratch/testbed/results.json`
- `testbed:report`는 Split 결과 표, 화면 모양별 표, 릴리스 노트에 넣을 줄을 낸다

## 저장소 구성(내용 v2, 2026-10-09)

내용은 [scenarios.ts](scenarios.ts)가 정본이다. 지어낸 제품(Lantern) 문서만 넣는다(공개 저장소).

| PR | 브랜치 | 담은 것 |
|---|---|---|
| #4 리뷰 시나리오 | `scenario/review` | 문단·목록·표·머리말·알림·각주·HTML 표·코드 블록 수정, 새 파일·지운 파일·이름만 바뀐 파일·이름과 내용이 같이 바뀐 파일, 렌더링에 안 드러나는 변경(`\|`), MDX. 심은 스레드 6개(한 줄·범위·지운 줄·해결됨·답글 있음·이름 바뀐 파일) |
| #5 큰 diff | `scenario/large` | 2,400줄이 바뀐 md 하나 |
| #6 파일 많은 PR | `scenario/many-files` | md 100개 + txt 20개 |
| #7 리뷰 뒤 따라온 커밋 | `scenario/followup` | 첫 커밋에 리뷰를 달고 작성자가 커밋을 하나 더 올린 PR. 심은 스레드 5개(낡은 줄·그대로인 줄·파일 전체·제안·코드와 목록과 링크가 든 서식) |

## 화면 모양(GitHub 톱니바퀴 메뉴)

| 프로젝트 | 바꾸는 법 | 계정 설정 |
|---|---|---|
| `split` | 주소 `?diff=split` | 안 바꿈 |
| `unified` | 주소 `?diff=unified` | 안 바꿈 |
| `whitespace`(Hide whitespace) | 주소 `?diff=split&w=1` | 안 바꿈 |
| `minimized`(Minimize comments) | 메뉴로 켬 → 끝나면 되돌림 | **바꿨다 되돌림** |
| `compact`(Compact line height) | 메뉴로 켬 → 끝나면 되돌림 | **바꿨다 되돌림** |

Minimize comments·Compact line height는 계정 설정(`POST /users/diffview`)으로만 바뀐다. 하네스는 바꾸기 전 값을 `.scratch/testbed/layout-original.json`에 적어 두고, 프로젝트가 끝나면 되돌리고 지운다. 중간에 멈춰 파일이 남았으면 다음 실행이 맨 먼저 그 값으로 되돌린다. split 프로젝트는 모든 시나리오, 나머지는 `@layout`이 붙은 시나리오만 돈다.

## 시나리오

| | 무엇을 | 어떻게 확인 | 태그 |
|---|---|---|---|
| T01 | 바뀐 md 6개는 렌더링 보기, 이름만 바뀐 파일·지운 파일은 그대로 | 화면 + 경고(`!`·알림) 없음 | quick·layout |
| T02 | 변경 없는 구간 접기·펼치기, 합친 표에서 바뀐 행만 | 화면 | layout |
| T03 | 렌더링에 안 드러나는 변경 안내 → 원문 보기 버튼 | 화면 | layout |
| T04 | 심은 스레드 6개가 가리키는 블록 아래에 붙음(해결된 것은 접힘) | 화면 | quick·layout |
| T05 | 블록 종류별 "+"가 고르는 줄(표 행·HTML 표·목록·알림·코드·각주) | 상자의 줄 표시 | quick·layout |
| T06 | 한 줄 코멘트 바로 올리기 | REST로 경로·쪽·줄 | layout |
| T07 | 끌어서 범위 → 리뷰 시작(노란 음영) | 보류 중인 리뷰의 코멘트 범위 | |
| T08 | 지운 문단에 원래 파일 쪽 코멘트, 보류 중인 리뷰가 있으면 "리뷰에 넣기"만 | REST `side: LEFT` | |
| T09 | 기존 스레드에 답글 | REST `in_reply_to_id` | |
| T10 | 해결 → 해결 취소 | GraphQL `isResolved` | |
| T11 | 이름이 바뀐 파일에 코멘트 | REST 새 경로 | |
| T12 | 큰 diff PR | 렌더링까지 시간, 경고 없음 | |
| T13 | 파일 120개 PR | md 100개 모두 렌더링, txt 그대로, 경고 없음 | |
| T14 | 로그아웃 화면(옛 `/files`) | 스레드 없는 md만 렌더링·접기, 스레드 있는 md는 원문 그대로, "+" 없음 | |
| T15 | 파일 툴바 요약, `]` `[` `}` `{` 이동 순서, 입력 중엔 키를 안 가로챔, 툴바 ↓는 그 파일 안에서만 | 안내 문구 + 위치(화면 위 30%) | quick·layout |
| T16 | 파일 전체 코멘트가 파일 맨 위에 보이고 답글을 달 수 있다 | 화면 + REST `in_reply_to_id` | layout |
| T17 | 따라온 커밋으로 낡은 스레드는 GitHub처럼 본문에 두지 않고 요약에도 세지 않는다 | 화면 + 요약 | |
| T18 | 제안(suggestion)·서식(목록·굵게·코드·링크) 코멘트를 GitHub 모양 그대로 | 화면 | layout |
| T19 | 보류 중인 리뷰가 있을 때 답글은 그 리뷰의 보류 중 답글 | GraphQL 상태 PENDING | |
| T20 | ⌘Enter(Ctrl+Enter)로 바로 올리기 | REST 범위 | |
| T21 | 합친 표의 바뀐 행에 코멘트 → 그 행의 줄, 다시 열면 표 뒤 | REST + 화면 | |
| T22 | 내 코멘트 편집(미리보기 포함) | REST 본문 | |
| T23 | 내 코멘트 삭제(두 번 눌러야) | REST에서 사라짐 | |
| T24 | 새 코멘트 미리보기(굵게·코드·멘션), 올리지 않고 닫기 | 화면 | |

## 지켜야 할 것

- 테스트가 쓰는 코멘트 본문에는 `testbed-run <실행 ID>`가 들어간다. 테스트마다 앞뒤로, 그리고 다음 `testbed:setup` 때 이 글이 든 코멘트와 내 보류 중인 리뷰를 지운다
- 심은 스레드는 본문 끝의 숨은 표시(`<!-- seed:para -->`)로 찾는다. 손으로 지우면 다음 설정 때 다시 단다
- 내용을 바꾸면 `FIXTURE_VERSION`을 올린다 — 열린 PR을 닫고 새로 연다(옛 PR은 닫힌 채 남는다)
- 다른 저장소에서 돌리려면 `TESTBED_REPO=<owner>/<repo>`(그리고 필요하면 `TESTBED_REMOTE=<push URL>`)
- 새 시나리오에는 태그를 고른다 — 빠르고 읽기만 하면 `@quick`(개발 중 등급), 화면 모양에 따라 달라질 수 있으면 `@layout`(검수 요청 전 등급에서 5가지로)

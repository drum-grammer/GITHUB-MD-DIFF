# Testbed — 배포 전 시나리오 하네스

공개 테스트 저장소 [drum-grammer/markdown-diff-cat-testbed](https://github.com/drum-grammer/markdown-diff-cat-testbed)의 PR에서 확장을 실제로 써 본다. 코멘트를 달고, 기존 스레드를 보고, 답글을 달고, 해결한다. 단위·E2E 테스트가 고정된 화면을 보는 것과 달리 이 하네스는 **GitHub에 실제로 쓰고 API로 다시 읽어** 줄 번호를 확인한다. 배포 전마다 돌린다.

## 돌리기

```bash
pnpm testbed:setup
```

```bash
pnpm testbed
```

```bash
pnpm testbed:report --out docs/reports/vX.Y.Z-testbed-results.md
```

- 준비: `gh auth login`(저장소 만들기·코멘트 쓰기·지우기)과 `pnpm e2e:login`(크롬 테스트 프로필의 GitHub 로그인). Node 22.18 이상(설정 스크립트가 `.ts`를 바로 읽는다)
- `testbed:setup`은 여러 번 돌려도 같다. 저장소가 없으면 만들고, 내용 버전이 다르면 다시 밀고, 심을 스레드가 없으면 달고, 지난 실행이 남긴 코멘트를 걷는다. 결과는 `.scratch/testbed/state.json`
- `testbed`는 확장을 빌드하고 시나리오를 돈다(약 2~3분). 결과는 `.scratch/testbed/results.json`
- `testbed:report`는 결과 표와 릴리스 노트에 넣을 줄을 낸다

## 저장소 구성

내용은 [scenarios.ts](scenarios.ts)가 정본이다. 지어낸 제품(Lantern) 문서만 넣는다(공개 저장소).

| PR | 브랜치 | 담은 것 |
|---|---|---|
| #1 리뷰 시나리오 | `scenario/review` | 문단·목록·표·머리말·알림·각주·HTML 표·코드 블록 수정, 새 파일·지운 파일·이름만 바뀐 파일·이름과 내용이 같이 바뀐 파일, 렌더링에 안 드러나는 변경(`\|`), MDX. 미리 심은 스레드 6개(한 줄·범위·지운 줄·해결됨·답글 있음·이름 바뀐 파일) |
| #2 큰 diff | `scenario/large` | 2,400줄이 바뀐 md 하나 |
| #3 파일 많은 PR | `scenario/many-files` | md 100개 + txt 20개 |

## 시나리오

| | 무엇을 | 어떻게 확인 |
|---|---|---|
| T01 | 바뀐 md 6개는 렌더링 보기, 이름만 바뀐 파일·지운 파일은 그대로 | 화면 + 경고(`!`·알림) 없음 |
| T02 | 변경 없는 구간 접기·펼치기, 합친 표에서 바뀐 행만 | 화면 |
| T03 | 렌더링에 안 드러나는 변경 안내 → 원문 보기 버튼 | 화면 |
| T04 | 심은 스레드 6개가 가리키는 블록 아래에 붙음(해결된 것은 접힘) | 화면 |
| T05 | 블록 종류별 "+"가 고르는 줄(표 행·HTML 표·목록·알림·코드·각주) | 상자의 줄 표시 |
| T06 | 한 줄 코멘트 바로 올리기 | REST로 경로·쪽·줄 |
| T07 | 끌어서 범위 → 리뷰 시작(노란 음영) | 보류 중인 리뷰의 코멘트 범위 |
| T08 | 지운 문단에 원래 파일 쪽 코멘트, 보류 중인 리뷰가 있으면 "리뷰에 넣기"만 | REST `side: LEFT` |
| T09 | 기존 스레드에 답글 | REST `in_reply_to_id` |
| T10 | 해결 → 해결 취소 | GraphQL `isResolved` |
| T11 | 이름이 바뀐 파일에 코멘트 | REST 새 경로 |
| T12 | 큰 diff PR | 렌더링까지 시간, 경고 없음 |
| T13 | 파일 120개 PR | md 100개 모두 렌더링, txt 그대로, 경고 없음 |
| T14 | 로그아웃 화면(옛 `/files`) | 렌더링·접기는 되고 "+"는 없음 |

## 지켜야 할 것

- 테스트가 쓰는 코멘트 본문에는 `testbed-run <실행 ID>`가 들어간다. 테스트마다 앞뒤로, 그리고 다음 `testbed:setup` 때 이 글이 든 코멘트와 내 보류 중인 리뷰를 지운다
- 심은 스레드는 본문 끝의 숨은 표시(`<!-- seed:para -->`)로 찾는다. 손으로 지우면 다음 설정 때 다시 단다
- 내용을 바꾸면 `FIXTURE_VERSION`을 올린다 — 열린 PR을 닫고 새로 연다(옛 PR은 닫힌 채 남는다)
- 다른 저장소에서 돌리려면 `TESTBED_REPO=<owner>/<repo>`(그리고 필요하면 `TESTBED_REMOTE=<push URL>`)

# GitHub 화면이 바뀌었을 때 — 알아채기·고치기·내보내기

> 최종 확인 2026-10-14 · [ROADMAP](../../ROADMAP.md) · 이 일이 처음 생긴 기록: [1.5.1 보고서](../reports/v1.5.1-github-class-names.md)
>
> **English summary** — The extension reads GitHub's "Files changed" page, which GitHub can change without notice. On 2026-10-14 GitHub renamed its CSS module classes (`Diff-module__diff__hash` → `diff__hash`) on the signed-in page and 1.5.0 silently stopped. Since 1.5.1 the extension finds files by their anchor id (`diff-<hash>`, the address of file links) and page structure first, accepts both class formats, and shows its warning when it can see file links but cannot read any file. Detect a change with the extension's warning, `pnpm canary` (the "class name format" check fails before users are hit), and `pnpm canary:status` (the canary itself stopped). Fix it in `src/selectors.ts` (or in `src/prose-markup.ts` for the markup inside the rendered diff, which `src/selectors.ts` re-exports), add the new format to `test/helpers.ts`, and ship a PATCH with the steps below.

확장은 GitHub "Files changed" 화면을 읽어서 동작한다. GitHub는 이 화면을 예고 없이 바꾼다. 클래스 이름은 GitHub 내부 사정이라 공지도 없다. 이 문서는 그런 변화를 빨리 알아채고, 고치고, 내보내는 순서다.

## 1. 지금 확장이 버티는 방법(1.5.1부터)

| 겹 | 무엇 | 어디 |
|---|---|---|
| 1. 잘 안 바뀌는 단서가 먼저 | 파일 묶음은 앵커 id `diff-<16진수 해시>`(PR 파일 링크 주소라 바꾸면 남의 링크가 깨진다). 버튼은 라벨(`Display the rich diff`·`Expand file`). 파일 이름은 머리의 `h3 code` | `src/selectors.ts` `isFileElement`·`headerOf`·`fileNameHeading` |
| 2. 해시 클래스는 두 형식 다 | `Module-module__local__해시`(2026-10-07)와 `local__해시`(2026-10-14). GitHub가 옛 형식으로 되돌려도 그대로 돈다 | `moduleClass()` |
| 3. 못 읽으면 말한다 | 파일 링크(`a[href^="#diff-"]`)는 보이는데 파일 묶음·이름을 5초 넘게 하나도 못 읽으면 툴바 `!`와 구석 안내("GitHub에 알리기") | `pageStructure` → `src/problems.ts` `structureProblem` → `src/content.ts` |
| 4. 시험·스크립트도 같은 가정 | E2E·테스트 저장소·canary·탐험·성능 스크립트가 `GITHUB_CSS` 하나를 쓴다. 따로 박힌 옛 선택자가 없다 | `GITHUB_CSS` · `scripts/page-css.mjs` |
| 5. 시험에 세 형식 | 단위 시험이 old·new·bare(해시 클래스 없음) 세 화면에서 같은 결과를 내야 한다 | `test/helpers.ts` `FILE_FORMATS` |

## 2. 빨리 알아채기

| 신호 | 뜻 | 어디서 보나 |
|---|---|---|
| canary ✗ **클래스 이름 형식** | GitHub가 클래스 형식을 또 바꿨다. **확장은 아직 돈다**(1겹) — 사용자보다 먼저 아는 신호 | `pnpm canary` · 깨지면 `canary` 라벨 이슈(맥 미니 예약이 돌 때) |
| canary ✗ **화면: …** · ✗ **확장 경고 없음** | 확장이 화면을 못 읽는다. 사용자도 겪고 있다 | 같음 |
| canary ✗ **PR 데이터·파일 원문** | 화면이 아니라 GitHub 내부 요청이 바뀌었다 → `src/github-api.ts` | 같음 |
| `pnpm canary:status` ✗ | 점검 자체가 2일 넘게 안 돌았다. 2026-10-11~14 예약이 한 번도 안 돌아 이번 일을 사용자가 먼저 겪었다 | 상시 켠 맥, 또는 아무 맥(기록은 기기마다) |
| 사용자 이슈 `GitHub change? problemNoFiles …` | 확장 경고에서 "GitHub에 알리기"로 온 것. 본문에 `files N, named N, loading N, links N` | 이슈 목록 |
| 사용자 말: "렌더링이 안 돼요" | 경고도 없이 안 된다면 3겹 감지 밖의 변화 — 아래 3번으로 | — |

## 3. 원인 좁히기(30분 안)

1. `pnpm canary` — 어느 점검이 깨졌나. 데이터 점검(PR 데이터·파일 원문)이 통과하고 화면 점검만 깨지면 화면(DOM) 변화다
2. 로그인한 크롬에서 아무 md PR의 "Files changed"를 열고 개발자 도구 콘솔에 붙여 넣는다 — 파일 묶음과 머리 주변의 해시 클래스 이름을 뽑는다

   ```js
   const f = [...document.querySelectorAll('div[id^="diff-"]')].find((e) => /^diff-[0-9a-f]{64}$/.test(e.id));
   const names = (root) => [...new Set([...root.querySelectorAll('*')].flatMap((e) => (typeof e.className === 'string' ? e.className.split(/\s+/) : [])).filter((c) => /__|-module/.test(c)))];
   ({ fileId: f?.id.length, fileClass: f?.className, header: names(f ?? document).slice(0, 40), modules: document.querySelectorAll('[class*="-module__"]').length })
   ```

   - `fileId`가 없으면 앵커 id까지 바뀐 것 — 1겹이 깨졌다. 파일 링크(`a[href^="#diff-"]`)가 어디를 가리키는지부터 본다
   - `modules`가 0이고 `diff__…` 같은 이름이 보이면 새 형식, `…-module__…`이면 옛 형식
3. 2026-10-14에 바뀐 이름 대응표(다음에 비교할 기준)

   | 쓰임 | 옛 형식(2026-10-07) | 새 형식(2026-10-14) |
   |---|---|---|
   | 파일 묶음 | `Diff-module__diff__…` | `diff__…` |
   | 파일 머리 | `DiffFileHeader-module__diff-file-header__…` | `diff-file-header__…`(한 겹 더 감쌈: `diffHeaderWrapper__…`) |
   | 파일 이름 | `DiffFileHeader-module__file-name__…` | `file-name__…` |
   | 줄 코멘트 스레드 | `InlineReviewThread-module__ReviewThreadContainer__…` | `ReviewThreadContainer__…`(해시가 여러 개) |
   | 불러오는 중 뼈대 | `LoadingSkeleton-module__skeleton__…` | `skeleton__…` |
   | 큰 diff 자리 | `HiddenDiffPatch-module__gridColumnTemplate__…` | `gridColumnTemplate__…` + "Load diff" 버튼 |

## 4. 고치기

1. 확장 저장소 `origin/main`에서 브랜치(`fix/X.Y.Z-…`)
2. **시험 먼저** — `test/helpers.ts`의 `FORMAT_CLASSES`에 새 형식을 넣고 `FILE_FORMATS`에 더한다. `pnpm test`가 새 형식에서 실패하는지 본다
3. `src/selectors.ts`(파일·머리·버튼)나 `src/prose-markup.ts`(렌더링 diff 본문 안 표기 — `unchanged`·`vicinity`·`ins`/`del`·표 `<del>`+`<ins>` 쌍. selectors.ts가 다시 내보낸다)만 고친다. selectors.ts의 import에는 `.ts`를 붙인다(Node가 `scripts/page-css.mjs`로 바로 읽는다) — 해시 클래스는 `moduleClass(모듈, 로컬)` 갈래를 늘리고, 옛 갈래는 지우지 않는다(되돌아올 수 있다)
4. `pnpm test` · `pnpm typecheck` → 로그인 E2E(`pnpm exec playwright test e2e/extension.spec.ts e2e/selection.spec.ts e2e/degraded.spec.ts`) → `pnpm canary`가 모두 통과
5. `static/manifest.json`·`package.json` 버전을 PATCH로 올리고, [UNRELEASED](../releases/UNRELEASED.md)에 사람이 읽을 몇 줄, ROADMAP "지금 어디에 있나"·버전 연표
6. `pnpm verify pr`(약 6분) → PR → 병합

## 5. 내보내기(사용자가 멈춰 있으니 빨리)

1. `main`에서 `pnpm verify release`(약 16분) — 하나라도 실패하면 멈춘다
2. `pnpm release check` → `pnpm release notes` → 노트 병합 → `pnpm release upload` → **채팅에서 관리자 확인** → `pnpm release submit --confirm X.Y.Z`. 절차 정본은 [store/README · Releasing an update](../../store/README.md#releasing-an-update)
3. 심사(며칠)를 기다리는 동안 관리자 크롬은 `pnpm dev:chrome`으로 고친 빌드를 쓴다
4. 게시되면 `pnpm release finish --confirm X.Y.Z`

## 6. GitHub가 되돌리거나 또 바꾸면

- **옛 형식으로 되돌림** — 할 일 없다. 두 형식을 다 받는다. canary "클래스 이름 형식" 줄이 `옛 형식(Diff-module__…)`으로 바뀐 것만 보인다
- **세 번째 형식** — 확장은 1겹(id·라벨·구조)으로 계속 돈다. canary "클래스 이름 형식"이 먼저 깨진다 → 위 3·4번으로 `moduleClass`를 맞추고 다음 PATCH에 싣는다(급하지 않다)
- **앵커 id까지 바뀜** — 확장이 `!`를 띄우고 canary 화면 점검이 깨진다 → 3번부터. 1겹의 단서를 새 화면에서 다시 고른다(파일 링크가 가리키는 대상이 가장 오래 간다)
- **렌더링 보기 자체가 바뀜**(`.prose-diff`가 없어짐) — 이미 `problemNoProseDiff`로 알린다(`hasUnknownRendering`)

## 7. 아직 남은 빈틈

- canary는 상시 켠 맥에서만 로그인 화면을 본다. 그 맥이 꺼져 있거나 화면 로그인이 안 되어 있으면 돌지 않는다 — `pnpm canary:status`를 다른 정기 점검에 붙인다
- 공개 저장소라 GitHub Actions에서 무료로 돌릴 수 있지만, 거기서는 로그아웃 화면(옛 화면)만 보인다. 로그인 세션을 Actions 비밀값에 넣는 것은 하지 않는다

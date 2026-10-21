# 로컬 렌더링 — GitHub가 못 그린 마크다운 diff를 확장이 직접 그리기

> 최종 확인 2026-10-21 · [ROADMAP](../../ROADMAP.md) · 앞 단계: [#51](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/51)(실패를 알아보고 원문으로) · 엔진: [packages/engine](../../packages/engine/README.md) · 로컬 리뷰: [docs/local-review](../local-review/README.md)
>
> **English summary** — Some large Markdown files never get a rendered diff on GitHub: the server times out (`page_data/rich_diff` returns 504 after about 10 seconds) and the page shows "This rich diff is not supported at the moment." Since #51 the extension recognizes that and switches to the source diff. With this change it first renders the diff itself, in the browser, with the engine already built for local review (`packages/engine`): it reads the old and new text from github.com with the signed-in session (the same requests comments already use), runs `diffMarkdown` and `renderProseDiff`, and puts the result where GitHub's rendered diff would be, so folding, table merging, navigation and block comments work as usual. A one-line note says the file was rendered in the browser, with **Show source diff**. If that fails too, the #51 behavior remains. No new permissions and no manifest change: the engine is bundled into the content script without KaTeX (GitHub's own `math-renderer` draws the math) and is only initialized when a file needs it.

이 문서는 설계와 결정의 근거(실측)를 한곳에 둔다. 구현 PR이 병합되면 **6. 남은 일**을 같은 PR에서 고친다.

## 0. 한 줄로

GitHub 서버가 렌더링 diff를 만들지 못한 md 파일을, 확장이 옛·새 원문을 받아 **브라우저 안에서 엔진으로 렌더링 diff를 그려** GitHub 렌더링 자리에 넣는다. 실패하면 #51처럼 원문 diff와 까닭을 보여 준다.

## 1. 왜

- 2026-10-21 비공개 저장소의 큰 설계 문서 PR에서 md 두 개(437 KB·224 KB)가 렌더링 보기에서 끝내 안 열렸다. GitHub 서버가 `page_data/rich_diff`를 10초쯤 렌더링하다 504로 끊고, 화면에는 `This rich diff is not supported at the moment.`만 남는다. 다시 눌러도 같고, 확장이 없어도 같다.
- 크기만으로 정해지지 않는다. 같은 PR의 261 KB 파일은 2초에 렌더링됐다. 미리 알 수 없다.
- #51은 이 실패를 바로 알아보고 원문 diff를 펼친다. 바뀐 곳은 보이지만 **렌더링된 모양은 못 본다**. 큰 설계 문서일수록 렌더링 diff가 필요한데, 바로 그 파일에서 안 된다.
- 확장에는 로컬 리뷰용 렌더링 diff 엔진(`packages/engine`, M1 [#48](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/48))이 이미 있다. GitHub rich diff와 같은 표기의 HTML을 내고(패리티 91.1%), 확장 화면 모듈(`applyBody`·접기·표 합치기·이동·코멘트)이 그 HTML에서 도는 것을 엔진 시험이 매번 확인한다.

## 2. 목표 · 하지 않을 것 · 실패로 칠 것

**목표**

1. GitHub가 렌더링을 못 만든 md 파일(실패 안내, 또는 누른 뒤 15초 넘게 빈 상자)을 확장이 그 자리에서 렌더링 diff로 그린다. 접기·표 합치기·이동·코멘트(+)·기존 스레드가 GitHub 렌더링 때와 같이 돈다.
2. 렌더링한 쪽이 확장이라는 것을 파일 머리 아래 한 줄로 알리고, **Show source diff**로 원문 보기로 갈 수 있다.
3. 로컬 렌더링도 못 하면(원문을 못 받음·엔진 오류·한도 초과) #51 동작 그대로 — 원문 diff를 펼치고, 까닭 한 줄과 **Try rich diff again**.
4. 권한·매니페스트는 그대로(`storage` + `https://github.com/*`). 요청은 github.com(과 github.com의 `raw`가 넘기는 raw.githubusercontent.com)뿐이고 로그인 세션 쿠키로 보낸다 — 코멘트 기능과 같은 요청이다.

**하지 않을 것**

- GitHub가 잘 그리는 파일을 엔진으로 바꿔 그리기(빠르게 보이려고·비교하려고) — GitHub 렌더링이 정본이다.
- 로그아웃 옛 화면(`/files`) — 렌더링 요청이 실패해도 원문 표를 그대로 두는 화면이라(#51 확인) 지금 문제가 없다.
- 커밋 일부 보기(`/pull/N/changes/<sha>`·`/files/<범위>`) — PR 데이터의 base·head가 화면의 범위와 달라 틀린 diff가 된다. 원문으로 둔다(#51 동작).
- 바깥 이미지 — GitHub는 camo 프록시의 서명 주소로 보여 주는데, 확장은 그 주소를 만들 수 없다. 엔진 기본값대로 막는다. 저장소 안 이미지는 보여 준다.
- Mermaid 그림 — 엔진은 코드 블록 자리표시로 둔다(GitHub는 별도 iframe).

**실패로 칠 것**(기능은 돌아도 안 되는 것)

- github.com의 다른 페이지가 느려진다 — content.js 컴파일이 눈에 띄게 늘거나, 엔진 코드가 페이지마다 초기화된다.
- 로컬 렌더링이 GitHub 렌더링인 척한다 — 안내 한 줄은 늘 있다.
- 원문 HTML이 정화 전에 살아 있는 문서에 닿는다 — `<img onerror>` 같은 것이 github.com 페이지에서 실행될 수 있다.
- 화면이 몇 초씩 아무 표시 없이 멈춘다.

## 3. 흐름

| 단계 | 화면 | 확장(`autorich.ts` 상태) |
|---|---|---|
| 1 | 확장이 렌더링 버튼을 누른다. 스피너 | `clicked` → `waiting` |
| 2 | GitHub 504 → 실패 안내 한 줄(또는 15초 넘게 빈 상자) | **`local`** — 원문 보기로 되돌리지 않는다. 안내 "GitHub could not render this file. Rendering it in your browser…" |
| 3 | (보이지 않음) PR 데이터(base·head·옛 경로·종류)와 옛·새 원문을 받고, 한 프레임 쉰 뒤 엔진을 돌린다 | `local` 유지 |
| 4 | GitHub 안내를 숨기고 그 상자 안에 렌더링 diff 본문을 넣는다. 안내 "GitHub could not render this file, so it was rendered in your browser." + **Show source diff** | 본문이 생겼으니 `rich` → `applyBody`·코멘트가 평소처럼 |
| 4' | 3이 실패하면 원문 보기 + 안내 "GitHub could not render this file, and it could not be rendered in your browser either, so the source diff is shown." + **Try rich diff again** | `fallback` |

- 엔진은 **화면 근처(위아래 한 화면 안) 파일만** 그린다. 확장은 md 파일을 차례로(최대 10개씩) 렌더링으로 누르므로 GitHub 실패는 화면 밖 파일에서도 돌아온다. 그 파일까지 바로 그리면 사람이 다른 곳을 읽는 동안 안내도 안 보이는 채 화면이 멈춘다. 멀리 있는 파일은 `local`로 두고 스크롤해 오면 그린다(1초마다 다시 본다).
- 사람이 원문 보기를 고르면(**Show source diff** 포함) 로컬 본문을 걷고 다시 그리지 않는다. 다시 렌더링 보기를 고르면 GitHub에 먼저 맡기고, 또 실패하면 기억해 둔 HTML로 바로 다시 그린다.
- **Try rich diff again**(4' 뒤)은 #51처럼 사람의 선택이다. GitHub가 또 실패하면 로컬 렌더링을 한 번 더 해 본다(원문 요청이 잠깐 실패했을 수 있다). 그것도 실패하면 렌더링 보기(GitHub 실패 안내)를 그대로 둔다 — 사람의 선택을 되돌리지 않는다.
- 확장을 끄면 `undoAll`이 로컬 본문과 안내를 걷고 GitHub 안내를 다시 보이게 한다.

## 4. 설계 결정과 근거

### 4-1. 원문을 어떻게 받나 — 이미 있는 요청 그대로

코멘트 기능이 블록과 원문 줄을 잇느라 이미 쓰는 두 요청을 같은 캐시로 쓴다(`src/comments.ts`의 `loadPr`·`loadText`를 따로 떼어 같이 쓴다).

- PR 데이터 `GET /{owner}/{repo}/pull/{n}/changes`(JSON) — `fullDiff.baseOid`·`headOid`, 파일별 `oldTreeEntry.path`(이름 바뀐 파일)·`changeType`. 코멘트가 `comparisonStartOid`·`comparisonEndOid`로 올리는 바로 그 두 커밋이라, 엔진 줄 번호(`data-mdc-new`·`data-mdc-old`)가 GitHub 코멘트 줄(`R12`·`L4`)과 맞는다.
- 원문 `fetchFileText` — GitHub 파일 보기의 `_styled` JSON(`rawLines`)을 먼저, 안 되면 `/raw/`.
- 추가된 파일은 옛 원문 없음(`null`), 지운 파일은 새 원문 없음(`null`) — 엔진 입력 규칙 그대로.

실측(2026-10-21, 로그인 테스트 프로필, 페이지 안 `fetch` — 확장 콘텐츠 스크립트와 같은 출처 규칙):

| 요청 | 결과 |
|---|---|
| 공개 testbed `/raw/{sha}/docs/large.md`(168 KB) | 200 · raw.githubusercontent.com으로 넘어감 · `type: cors` · 1.3초 |
| 같은 파일 `_styled` | 200 · `rawLines` 있음 · 0.55초 |
| 비공개 저장소 `/raw/HEAD/README.md` | 200 · raw.githubusercontent.com(`?token=`)으로 넘어감 · `type: cors`, 읽힘 (상태만 확인) |

`raw`가 다른 출처로 넘어가도 raw.githubusercontent.com이 `Access-Control-Allow-Origin: *`을 주고, 쿠키 없이 주소의 토큰으로 열리므로 CORS가 막지 않는다. 권한(`host_permissions`)을 늘릴 필요가 없다.

### 4-2. 엔진을 확장 번들에 — KaTeX 없이, 처음 쓸 때만

| | content.js | 페이지마다 컴파일(Node `vm.Script`, 5회 최소) |
|---|---|---|
| 지금(1.5.1 + #51) | 331 KB | 3.0 ms |
| 엔진 그대로(KaTeX 포함) | 약 1.5 MB | — (KaTeX만 657 KB) |
| **엔진, KaTeX 대신 GitHub `math-renderer`** | **640 KB** | **4.8 ms** |

- **DOM** — 엔진은 `packages/engine/src/dom.ts` 한 곳에서만 DOM을 얻는다(jsdom). 확장 빌드는 이 모듈을 브라우저판 `src/engine-dom.ts`로 바꿔 끼운다(esbuild 플러그인). 브라우저판은 DOMPurify에 실제 `window`를 주고, 엔진이 HTML을 읽고 쓰는 문서는 `document.implementation.createHTMLDocument('')`로 만든 **inert 문서**다 — 그 안의 `<img>`는 불러오지 않고 이벤트 처리기도 돌지 않는다. 엔진이 정화를 끝낸 HTML 문자열만 살아 있는 페이지에 들어간다.
- **수식** — GitHub rich diff는 수식을 서버에서 그리지 않고 `<math-renderer class="js-inline-math">$…$</math-renderer>`를 내면 페이지가 MathML로 바꾼다. 실측: 확장이 아닌 쪽에서 넣은 `math-renderer`도 GitHub 페이지가 그 자리에서 MathML로 바꿨다(testbed #5·#8, 2026-10-21). 그래서 확장 빌드는 `katex`를 `renderToString`만 있는 작은 대역(`src/engine-math.ts`)으로 바꿔 GitHub와 같은 표기를 낸다. 페이지가 바꾸지 못하면 TeX 원문이 글자로 보인다.
- **두 번 거른다** — 넣기 전에 로컬 리뷰 페이지처럼 `safeFragment`로 한 번 더 거른다(스크립트·이벤트 속성·위험한 주소). 그리고 GitHub 스크립트가 붙잡는 훅 클래스 가운데 엔진이 흉내 낸 Mermaid 자리(`js-render-needs-enrichment`)는 뗀다 — 붙여 두면 GitHub 스크립트가 그림 iframe을 찾다 페이지 오류를 냈다(testbed #8, 2026-10-21). 표(`markdown-accessiblity-table`)·수식(`math-renderer`)·접기 묶음(`js-expandable`)은 GitHub rich diff와 같은 표기라 그대로 둔다.
- **엔진만 내는 표기의 모양** — "원문만 바뀜" 막대(`.mdc-source-only`)·사용자 `<ins>`·`<del>`(`.mdc-user-*`)·막은 이미지는 GitHub 스타일에 없다. 로컬 리뷰 페이지의 CSS를 `[data-mdf-local]` 아래로 옮기고, 막대를 펼치는 처리(`wireSourceToggles`)는 `applyBody`가 단다(로컬 리뷰 페이지와 같이 쓴다). 수식은 단어 비교에서 쪼개지 않는다(`math-renderer`를 원자 요소로).
- **처음 쓸 때만 초기화** — `content.ts`는 엔진을 `import()`로 부른다. esbuild는 IIFE 한 파일 안에서 그 모듈을 지연 초기화(`__esm`)로 묶으므로, 실패한 파일이 없는 페이지에서는 엔진 코드가 한 줄도 돌지 않고 읽기(파싱) 비용만 남는다.
- **지키는 장치** — 빌드가 content.js에 jsdom·katex가 들어가면 실패한다(`scripts/build-lib.mjs`). `web_accessible_resources`로 엔진을 따로 내려받게 하는 길도 있지만 매니페스트를 바꾸고 페이지가 확장 파일을 알아볼 수 있게 된다 — 640 KB 안이라 쓰지 않는다.

### 4-3. 본문을 어디에 넣나

실측(testbed #5, 확장 끔):

| | 파일 상자 안 |
|---|---|
| GitHub 렌더링 성공 | 머리 칸 → `div.border.position-relative.rounded-bottom-2` › `div.prose-diff.position-relative` › `div` › `article.markdown-body.entry-content.container-lg` |
| GitHub 실패 | 머리 칸 → `div.border.position-relative.rounded-bottom-2` › `div.d-flex.flex-justify-center` "This rich diff is not supported at the moment." |

- 성공 때와 같은 껍데기를 만들어 같은 상자 안 끝에 넣는다: `div.prose-diff.position-relative[data-mdf-local]` › `div` › `article.markdown-body.entry-content.container-lg`. 그러면 `proseBody`(`.prose-diff .markdown-body`)가 그대로 찾고, 접기·코멘트 상자 위치도 GitHub 렌더링 때와 같다.
- GitHub의 실패 안내는 지우지 않고 숨긴다(`mdf-hidden`, `undoAll`이 되돌림). React가 관리하는 요소를 지우면 다음 다시 그리기에서 React가 깨질 수 있다. 안내는 Primer `.d-flex`(`display: flex !important`)라 `.mdf-hidden` 하나로는 지고, 한 단계 무거운 규칙(`.mdf-hidden.mdf-hidden`)으로 숨긴다(실측).
- 표시는 `data-mdf`가 아니라 `data-mdf-local`이다 — 확장 모듈은 `[data-mdf]` 안을 "확장이 만든 것"으로 보고 블록·변경 표시를 세지 않는다(`dom-blocks`·`noteNoVisibleChange`).
- 원문 보기를 고르면 React가 상자 안을 원문 표로 바꾸지만 남의 요소(로컬 본문)는 남겨 둔다. 그래서 훑을 때마다 "렌더링 버튼이 눌려 있지 않은데 로컬 본문이 있다"면 걷는다. GitHub 렌더링이 나중에 성공해 본문이 둘이 되면 로컬 본문을 걷는다.
- GitHub가 상자를 다시 그려 로컬 본문이 사라지면(접었다 펼치기 등) 다음 훑기에서 기억해 둔 HTML을 다시 넣는다 — 같은 파일·같은 머리 커밋이면 엔진을 다시 돌리지 않는다.

### 4-4. 화면 모듈과 코멘트

- 본문이 생기면 `ensureRich`가 `rich`를 돌려주고, 그 뒤는 GitHub 렌더링과 같은 길이다 — `applyBody`(표 합치기·접기·파일 툴바) · `noteNoVisibleChange` · `attachComments`.
- 코멘트의 블록 ↔ 줄은 원문을 다시 맞추지 않고 엔진이 단 줄 속성으로 읽는다 — 로컬 리뷰 페이지의 `mappingFromAttributes`를 `src/dom-blocks.ts`로 옮겨 둘이 같이 쓴다. `GitHubCommentBackend.mapping`은 본문이 로컬 본문이면 이것을, 아니면 지금처럼 `mapBlocks`를 쓴다. 제안 버튼에 넣을 머리 커밋 원문 줄은 같은 캐시에서 읽는다.
- 로컬 렌더링은 로그인한 새 화면에서만 생기므로(실패 안내가 새 화면의 것이다) PR 데이터를 늘 읽을 수 있다. 코멘트가 꺼진 PR(요청 모양이 바뀜 등)에서도 렌더링 diff는 보여 준다.

### 4-5. 엔진에 더할 것(공개 API에 선택 항목 둘)

`RenderContext`에 선택 항목을 더한다 — 로컬 리뷰는 바뀌지 않는다.

- `imageUrl?(side, repoPath): string | null` — 있으면 저장소 안 이미지의 `src`를 이 값으로(없으면 지금처럼 `imageId` → `/file/<id>`). 확장은 `/{owner}/{repo}/raw/{oid}/{path}`를 준다(옛 쪽은 base, 새 쪽은 head). raw는 *.githubusercontent.com으로 넘어가고, github.com의 이미지 CSP가 이를 허용하는지 E2E에서 확인한다.
- `annotations?: boolean`(기본 `true`) — `false`면 Codex 주석 속성(`oai-*`)을 달지 않는다. github.com에는 필요 없다.

### 4-6. 속도와 한도

실측(엔진만, 같은 입력):

| 입력 | 브라우저(headless Chromium) | Node + jsdom |
|---|---|---|
| testbed #5 `docs/large.md` — 2,400문단 모두 고침(158→168 KB) | diffMarkdown 1.1–1.2초 · renderProseDiff 25 ms · 넣기 10 ms | 2.0–2.2초 · 0.4초 |
| 지어낸 설계 문서(Lantern) 371 KB · 15곳 고침 | 0.5–0.6초 · 40 ms · 30 ms | 2.6초 · 0.4초 |

- 이 시간 동안 화면이 멈추므로, "Rendering it in your browser…" 안내를 먼저 그리고 한 프레임 뒤에 엔진을 돌린다. 한 번에 한 파일씩, 화면 근처 파일만(§3).
- 한도: 옛·새 원문을 합쳐 **120만 자**(한 쪽 약 60만 자 — 계기가 된 437 KB 문서가 들어간다)를 넘으면 엔진을 돌리지 않고 원문으로. 고친 곳이 적은 큰 문서는 1초 안팎, 거의 모든 문단을 고친 한도 근처 문서는 몇 초 멈출 수 있다 — GitHub가 이미 10초를 기다리게 한 파일이고 안내가 먼저 보인다. 엔진의 짝짓기 한도(`ENGINE_MAX_CELLS`)가 최악의 경우를 한 번 더 막는다. 블록 사이에 쉬어 가며 그리기(엔진 변경)는 하지 않는다.
- 엔진 오류도 원문 요청 실패·한도 초과처럼 원문으로 되돌린다. 그때 안내가 "브라우저에서도 못 그렸다"고 말하고, 까닭은 콘솔 경고(`[github-md-diff]`)에 남긴다. 툴바 "!"·문제 보고는 GitHub 화면이 바뀐 신호에만 쓰므로 여기에는 쓰지 않는다.
- 웹 워커는 쓰지 않는다 — 콘텐츠 스크립트에서 확장 파일로 워커를 만들 수 없고, 정화(DOMPurify)에 DOM이 필요하다.

### 4-7. 상태 기계(`autorich.ts`)

- 새 상태 `local` — GitHub가 실패해 로컬 렌더링 중이거나, 렌더링했는데 본문이 아직(또는 다시) 들어가지 않았다. 문제(`problems.ts`)로 세지 않고, 버튼을 찾은 상태로 센다.
- 새 기록 `local`(로컬로 맡은 파일)·`localFailed`(로컬로도 못 한 파일). GitHub 실패를 알아본 곳(실패 안내·15초 빈 상자, 사람이 고른 렌더링의 실패)에서 "로컬로 할 수 있으면 `local`, 아니면 `fallback`"을 고른다. 로컬로 할 수 있는지는 `content.ts`가 넘긴다(로그인 · 커밋 일부 보기가 아님).
- 로컬 렌더링이 실패하면 `content.ts`가 `localFailed`로 알리고 그때 원문으로 되돌린다(#51의 `fallBack` 그대로).

### 4-8. 문구(영어 — 확장 화면은 GitHub처럼 영어, 한국어 파일도 같이)

| 키 | en | ko |
|---|---|---|
| `localRendering` | GitHub could not render this file. Rendering it in your browser… | GitHub가 이 파일을 렌더링하지 못해 브라우저에서 렌더링하고 있어요… |
| `localRendered` | GitHub could not render this file, so it was rendered in your browser. It may differ slightly from GitHub's rendering. | GitHub가 이 파일을 렌더링하지 못해 브라우저에서 렌더링했어요. GitHub 렌더링과 조금 다를 수 있어요. |
| `richFailedLocal` | GitHub could not render this file, and it could not be rendered in your browser either, so the source diff is shown. | GitHub도, 브라우저에서도 이 파일을 렌더링하지 못해 원문 diff를 보여 줘요. |
| 버튼 | `showSource` — Show source diff(있는 문구) | 원문 보기로 |

## 5. 시험

- **단위**: 상태 기계(실패 안내 → `local`, 로컬 실패 → `fallback`, 사람이 고른 렌더링의 실패 → `local`, 원문을 고르면 로컬 본문을 걷음) · 로컬 렌더링 모듈(가짜 요청으로 본문 넣기·껍데기 모양·안내·캐시·한도·실패) · 브라우저 DOM 대역(inert 문서) · 수식 대역 · 줄 속성 매핑 · 빌드에 jsdom·katex가 없음.
- **E2E** `e2e/rich-failure.spec.ts`(testbed #5 `docs/large.md`, `page_data/rich_diff`에 504를 흉내):
  1. 504 → 로컬 본문(`[data-mdf-local] .markdown-body`)·안내·`Entry 0001` 바뀐 표시·접기 막대가 보이고, 원문 보기로 되돌리지 않고, 문제 알림이 없다. 블록에 마우스를 올리면 `+`가 나오고 코멘트 상자 머리글이 엔진 줄 번호(`R…`)다.
  2. **Show source diff** → 원문 보기, 로컬 본문이 사라지고 다시 생기지 않는다.
  3. 원문 요청도 실패시키면(`_styled`·`raw`에 500) #51 동작 — 원문·Load Diff 자동·안내·**Try rich diff again**(#51의 두 시험을 이 조건으로).
  4. 수식: testbed #8 `parity/math.md`에 504 → 로컬 본문의 `math-renderer` 안에 MathML이 생긴다.
- **관문**: `pnpm verify pr`.

## 6. 남은 일

- [ ] 구현 PR — 이 문서의 결정대로(버전은 다음 MINOR, `UNRELEASED`의 New)
- 나중에(수요 보고): 로그아웃 옛 화면 · 커밋 일부 보기(그 범위의 base·head를 화면에서 읽어야 함) · 바깥 이미지 · Mermaid · 엔진이 GitHub와 다른 곳([KNOWN-DIFFERENCES](../../packages/engine/parity/KNOWN-DIFFERENCES.md)) — 로컬 렌더링은 GitHub 렌더링과 조금 다를 수 있다는 것을 안내 문구가 말한다.

## 7. 누가 정했나

| 결정 | 누가 |
|---|---|
| 권한·매니페스트를 늘리지 않는다 · 엔진(`diffMarkdown`·`renderProseDiff`)을 확장 안 대체 렌더러로 · #51 위에서 "되돌리기" 앞에 "로컬로 렌더링" 단계 · 새 기능이라 MINOR · 공개 저장소라 회사 내용 없음 | 요청(2026-10-21) |
| 원문은 코멘트와 같은 요청·캐시 · KaTeX 대신 GitHub `math-renderer` · 같은 content.js 안에서 지연 초기화(따로 내려받기 안 함) · 성공 때와 같은 껍데기를 상자 안에 · 실패 안내는 숨김 · `data-mdf-local` · 줄은 엔진 속성으로 · 엔진 선택 항목 둘 · 안내 문구 · 사람이 고른 렌더링이 실패해도 로컬로 한 번 더 | 구현 세션 판단(근거는 위 실측) |
| 설계 검토(처음 보는 구현자 역할의 에이전트)가 물은 셋 — 멈춤 한도(→ 120만 자, 블록 사이 쉬기 없음) · 화면 밖 파일(→ 근처에서만) · 엔진 오류를 문제로 알릴지(→ 안내 문구로만, "!" 없음) | 구현 세션 판단 |

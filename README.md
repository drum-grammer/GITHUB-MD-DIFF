<p align="center"><img src="static/icons/icon128.png" width="96" alt=""></p>

<h1 align="center">Markdown Diff Cat for GitHub</h1>

<p align="center">See only what changed in Markdown files on GitHub pull requests — rendered, not raw.</p>

<p align="center"><a href="#한국어">한국어</a></p>

![Markdown Diff Cat folds unchanged sections and shows table changes row by row](docs/demo.gif)

## Why

AI coding assistants write long design documents, and reviewing them in a pull request is painful:

- **Rich diff** (the rendered view) opens the whole file. You scroll past hundreds of unchanged lines to find the few that changed.
- **Source diff** shows only the changes, but they are buried in Markdown syntax, table pipes, and code fences.

Markdown Diff Cat gives you both: the rendered document, with only the changes in view.

## What it does

- **Opens the rendered view for you** on every `.md`, `.markdown`, and `.mdx` file on the "Files changed" page
- **Folds unchanged sections** into one-line bars that show how many blocks they hide and the last heading inside. Click a bar to expand it, or **Expand all** at the top of the file
- **Shows only the changed rows of tables.** When one row changes, GitHub shows the whole old table and the whole new table. Markdown Diff Cat merges them into one table with only the changed, added, and removed rows, and shows changed cells as old → new. **All rows** and **Original tables** buttons sit above each merged table
- **Comment right in the rendered view** (signed in to GitHub)
  - Hover over a block and click **+**, or drag from **+** to another block to comment on a range
  - The comment lands on the right source line as an ordinary GitHub review comment: add a single comment, or start or add to your review
  - Existing review threads show under the block they refer to, where you can reply and resolve them
- **Stays out of your way**
  - Click `<>` (source) on a file to leave a comment and it will not switch that file back until you choose the rich diff again or reload
  - Signed out, files that already have inline review comments stay in the source view, because only signed-in users see threads in the rendered view
  - Collapsed files (collapsed or marked **Viewed**) stay collapsed
- **One click on or off.** The toolbar icon is in color when on and gray when off. A `!` badge appears only when the page could not be read; hover over it for the reason

Works on both "Files changed" pages: the new one for signed-in users (`/pull/<n>/changes`) and the classic one (`/pull/<n>/files`).

## Install

**Chrome Web Store** — [Markdown Diff Cat for GitHub](https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj)

If Enhanced Safe Browsing is on, Chrome may say "Proceed with caution" because the extension is not trusted by Enhanced Safe Browsing yet. Google trusts extensions from publishers that follow its policies, and new publishers usually take a few months ([Chrome Web Store Help](https://support.google.com/chrome_webstore/answer/2664769)). Choose **Continue to install**.

Release notes: [GitHub Releases](https://github.com/drum-grammer/GITHUB-MD-DIFF/releases)

**From source (developer mode)**

1. `pnpm install && pnpm build`
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose `dist/`
3. To update: `git pull && pnpm build`, click ↻ on the extension card, then reload open GitHub tabs

## Privacy

No data collected and no remote code. The extension reads the open GitHub page inside your browser to change how it is displayed. When you are signed in, it also talks to GitHub, and only to GitHub, with the session you already have: it loads the pull request's review threads and the Markdown files it shows, and posts the comments you write. Nothing goes to the developer or anyone else, and no token is used. Its one setting (on or off) stays in `chrome.storage.local`. Permissions: `storage`, and access to `https://github.com/*`. Full policy: [PRIVACY.md](PRIVACY.md).

## Limits

- Files that GitHub does not render (very large files behind "Load diff") are left as they are
- It relies on GitHub's page structure. When GitHub changes it, the icon shows `!` until an update ships. Please [open an issue](https://github.com/drum-grammer/GITHUB-MD-DIFF/issues)
- Commenting uses the same internal requests as GitHub's own "Files changed" page, which are not a public API. They live only in `src/github-api.ts`. If GitHub changes them, the extension turns commenting off on its own: no **+**, files with review threads stay in the source view as before, and folding and tables keep working. The toolbar icon shows `!`, and a note in the corner of the page has a **Report on GitHub** link that opens a prefilled issue (no repository name or URL in it). A comment that fails to post stays in its box so you can copy it
- A block gets **+** only when it can be matched to its source lines. Blocks GitHub draws from HTML or diagrams may not get one; use the source diff for those

## Develop

- `pnpm test` — unit and DOM tests (vitest + jsdom)
- `pnpm typecheck`
- `pnpm e2e:login` once — sign in to GitHub in the window that opens, then close it. The profile lives in `~/.cache/github-md-diff/e2e-profile` (outside the repo)
- `pnpm e2e` — real Chromium with the extension against public pull requests, signed in and signed out
- `GMD_E2E_WRITE=1 pnpm e2e` — also posts comments from the rendered view to the demo pull request as a pending review, checks their source lines, and deletes the review with `gh` (needs `gh` signed in as the repository owner)
- `pnpm canary [--notify]` — read-only check against live GitHub of everything the extension relies on: signed-in pull request data, file text, auto rich diff, folding, merged tables, **+** on the right line, matching rate, and the signed-out classic page. Exit code 1 when something broke; results go to `~/.cache/github-md-diff/canary.log`. `--notify` shows a macOS notification and prints a prefilled issue link
- `node scripts/mapping-report.mjs <pull request URL>…` (after `pnpm build`) — how many rendered blocks of each Markdown file match their source lines, and how long matching takes. Read-only
- `pnpm icons` — regenerate `static/icons/icon{16,32,48,128}.png` from `icon.svg` and `icon{16,32}-off.png` from `icon-off.svg` (commit the PNGs)
- `pnpm package` — build and zip `dist/` into `release/` for the Chrome Web Store
- `pnpm store:assets` — regenerate the store screenshots, promo tiles, and `docs/demo.gif`. See [store/README.md](store/README.md)
- GitHub page assumptions live only in `src/selectors.ts`, and GitHub request assumptions only in `src/github-api.ts`
- Test fixtures must come from public repositories or be handmade; the first line records the source and `test/fixtures.test.ts` checks it

## Thanks

The request shapes for commenting were first written up by [Markdown PR](https://github.com/chienyuanchang/rich-diff-comments) and [Mihiraki](https://github.com/KinjiKawaguchi/mihiraki) (both MIT).

## License

[MIT](LICENSE)

Unofficial. Not affiliated with or endorsed by GitHub. GitHub is a trademark of GitHub, Inc.

---

## 한국어

![바뀌지 않은 구간은 접고 표는 바뀐 행만 보여 줍니다](docs/demo-ko.gif)

### 왜 만들었나

AI가 설계 문서를 길게 써 주면서, PR에서 마크다운 문서를 리뷰하기가 더 힘들어졌어요.

- **렌더링 보기(rich diff)** 는 파일 전체를 펼쳐요. 바뀐 몇 줄을 찾으려고 바뀌지 않은 수백 줄을 스크롤해야 해요.
- **원문 보기(source diff)** 는 바뀐 부분만 보여 주지만, 마크다운 기호·표 구분선·코드 블록에 묻혀 읽기 어려워요.

Markdown Diff Cat은 두 장점을 합쳤어요. 렌더링된 문서를 보면서, 바뀐 부분만 눈앞에 둡니다.

### 이런 걸 해요

- **렌더링 보기로 자동 전환** — "Files changed" 화면의 `.md`·`.markdown`·`.mdx` 파일
- **바뀌지 않은 구간 접기** — 한 줄 막대에 숨긴 블록 수와 마지막 제목이 보여요. 누르면 그 자리만 펼치고, 파일 위 **모두 펼치기**로 한 번에 펼쳐요
- **표는 바뀐 행만** — 행 하나만 바뀌어도 GitHub는 옛 표 전체와 새 표 전체를 보여 줘요. 바뀐·추가된·삭제된 행만 남긴 표 하나로 합치고, 바뀐 칸은 이전 → 이후로 보여 줘요. 표 위 **전체 행**·**원래 표** 버튼으로 언제든 바꿔 볼 수 있어요
- **렌더링 보기에서 바로 코멘트** (GitHub에 로그인한 경우)
  - 블록에 마우스를 올리고 **+**를 누르거나, **+**에서 다른 블록까지 끌면 그 범위에 달아요
  - 코멘트는 맞는 원문 줄에 붙는 보통의 GitHub 리뷰 코멘트예요. 단일 코멘트로 달거나 리뷰를 시작·추가할 수 있어요
  - 이미 달린 리뷰 스레드는 그 블록 아래에 보이고, 답글과 해결도 그 자리에서 해요
- **방해하지 않아요**
  - 코멘트를 달려고 `<>`(원문)를 누르면, 렌더링 보기를 다시 고르거나 새로고침하기 전까지 그 파일은 그대로 둬요
  - 로그아웃 상태에서는 리뷰 코멘트가 이미 달린 파일을 원문 보기 그대로 둬요. 렌더링 보기의 스레드는 로그인해야 보이거든요
  - 접어 둔 파일·**Viewed** 표시한 파일도 그대로 둬요
- **한 번에 켜고 끄기** — 툴바 아이콘이 컬러면 켜짐, 회색이면 꺼짐이에요. 화면을 읽지 못했을 때만 `!` 배지가 뜨고, 마우스를 올리면 이유가 보여요

로그인한 새 화면(`/pull/<n>/changes`)과 옛 화면(`/pull/<n>/files`) 모두에서 동작해요.

### 설치

**크롬 웹 스토어** — [Markdown Diff Cat for GitHub](https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj)

향상된 세이프 브라우징을 켜 두었다면 "주의해서 진행하시기 바랍니다" 창이 뜰 수 있어요. 새 게시자의 확장이라 아직 신뢰 목록에 오르지 않아서예요. Google은 정책을 지키는 게시자의 확장을 신뢰하고, 새 게시자는 보통 몇 달 걸린다고 안내해요([크롬 웹 스토어 고객센터](https://support.google.com/chrome_webstore/answer/2664769?hl=ko)). **설치 계속**을 누르면 돼요.

릴리스 노트: [GitHub Releases](https://github.com/drum-grammer/GITHUB-MD-DIFF/releases)

소스에서 설치하는 방법은 위 [Install](#install)에 있어요.

### 개인정보

수집하는 데이터와 원격 코드가 없어요. 열린 GitHub 페이지는 보여 주는 모양을 바꾸려고 브라우저 안에서 읽어요. 로그인한 경우에는 이미 있는 세션으로 GitHub하고만 통신해요 — PR의 리뷰 스레드와 보여 주는 마크다운 파일을 읽고, 내가 쓴 코멘트를 올려요. 개발자나 다른 곳으로는 아무것도 보내지 않고 토큰도 쓰지 않아요. 설정 하나(켜짐·꺼짐)만 `chrome.storage.local`에 저장해요. 전문: [PRIVACY.md](PRIVACY.md).

GitHub와 관련 없는 비공식 도구이며 GitHub의 보증을 받지 않았습니다. GitHub는 GitHub, Inc.의 상표입니다.

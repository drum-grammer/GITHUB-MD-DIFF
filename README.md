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
- **Stays out of your way**
  - Click `<>` (source) on a file to leave a comment and it will not switch that file back until you choose the rich diff again or reload
  - Files that already have inline review comments stay in the source view, because the rich diff does not show comment threads
  - Collapsed files (collapsed or marked **Viewed**) stay collapsed
- **One click on or off.** The toolbar icon is in color when on and gray when off. A `!` badge appears only when the page could not be read; hover over it for the reason

Works on both "Files changed" pages: the new one for signed-in users (`/pull/<n>/changes`) and the classic one (`/pull/<n>/files`).

## Install

**Chrome Web Store** — under review. This section will link to the listing once it is published.

**From source (developer mode)**

1. `pnpm install && pnpm build`
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose `dist/`
3. To update: `git pull && pnpm build`, click ↻ on the extension card, then reload open GitHub tabs

## Privacy

No data collected, no network requests, no remote code. The extension reads the open GitHub page inside your browser only to change how it is displayed. Its one setting (on or off) stays in `chrome.storage.local`. Permissions: `storage`, and access to `https://github.com/*`. Full policy: [PRIVACY.md](PRIVACY.md).

## Limits

- Files that GitHub does not render (very large files behind "Load diff") are left as they are
- It relies on GitHub's page structure. When GitHub changes it, the icon shows `!` until an update ships. Please [open an issue](https://github.com/drum-grammer/GITHUB-MD-DIFF/issues)

## Develop

- `pnpm test` — unit and DOM tests (vitest + jsdom)
- `pnpm typecheck`
- `pnpm e2e:login` once — sign in to GitHub in the window that opens, then close it. The profile lives in `~/.cache/github-md-diff/e2e-profile` (outside the repo)
- `pnpm e2e` — real Chromium with the extension against public pull requests, signed in and signed out
- `pnpm icons` — regenerate `static/icons/icon{16,32,48,128}.png` from `icon.svg` and `icon{16,32}-off.png` from `icon-off.svg` (commit the PNGs)
- `pnpm package` — build and zip `dist/` into `release/` for the Chrome Web Store
- `pnpm store:assets` — regenerate the store screenshots, promo tiles, and `docs/demo.gif`. See [store/README.md](store/README.md)
- GitHub page assumptions live only in `src/selectors.ts`
- Test fixtures must come from public repositories or be handmade; the first line records the source and `test/fixtures.test.ts` checks it

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
- **방해하지 않아요**
  - 코멘트를 달려고 `<>`(원문)를 누르면, 렌더링 보기를 다시 고르거나 새로고침하기 전까지 그 파일은 그대로 둬요
  - 리뷰 코멘트가 이미 달린 파일은 원문 보기 그대로 둬요. 렌더링 보기에는 코멘트가 안 보이거든요
  - 접어 둔 파일·**Viewed** 표시한 파일도 그대로 둬요
- **한 번에 켜고 끄기** — 툴바 아이콘이 컬러면 켜짐, 회색이면 꺼짐이에요. 화면을 읽지 못했을 때만 `!` 배지가 뜨고, 마우스를 올리면 이유가 보여요

로그인한 새 화면(`/pull/<n>/changes`)과 옛 화면(`/pull/<n>/files`) 모두에서 동작해요.

### 개인정보

수집하는 데이터가 없고, 네트워크 요청도 원격 코드도 없어요. 열린 GitHub 페이지는 보여 주는 모양을 바꾸려고 브라우저 안에서만 읽어요. 설정 하나(켜짐·꺼짐)만 `chrome.storage.local`에 저장해요. 전문: [PRIVACY.md](PRIVACY.md).

GitHub와 관련 없는 비공식 도구이며 GitHub의 보증을 받지 않았습니다. GitHub는 GitHub, Inc.의 상표입니다.

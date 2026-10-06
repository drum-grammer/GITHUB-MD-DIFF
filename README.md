# GitHub MD Diff

Chrome extension that shows Markdown files in GitHub pull requests as **rendered diffs with only the changed parts visible**.

GitHub PR의 마크다운 파일을 **렌더링된 모양으로, 바뀐 부분만** 보여 주는 크롬 확장입니다.

## What it does

- Switches `.md` / `.markdown` / `.mdx` files on the PR "Files changed" page to the rich diff automatically
- Folds unchanged sections into one-line bars — click a bar to expand it, or use **Expand all** at the top of each file
- Tables: when one row changes, GitHub shows the whole old table and the whole new table. The extension merges them into one table that shows only changed, added and removed rows, with old/new values in changed cells. **All rows** and **Original tables** buttons sit above each merged table
- If you click `<>` (source) on a file to leave a comment, the extension will not switch that file back
- Toolbar icon turns everything on or off. Badge: `ON`, empty when off, `!` when the page could not be read (hover for the reason)

## Privacy

No network requests, no tokens, no data collection. Permissions: `storage` (on/off) and access to `https://github.com/*` pages.

## Limits

- Works on the new "Files changed" page that GitHub shows to signed-in users (`/pull/<n>/changes`). The classic page is left as is
- Files that GitHub does not render (very large files behind "Load diff") are left as is

## Install (developer mode)

1. `pnpm install && pnpm build`
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose `dist/`
3. To update: `git pull && pnpm build`, then click ↻ on the extension card

## Develop

- `pnpm test` — unit and DOM tests (vitest + jsdom)
- `pnpm typecheck`
- `pnpm e2e:login` once — sign in to GitHub in the window that opens, then close it. The profile lives in `~/.cache/github-md-diff/e2e-profile` (outside the repo)
- `pnpm e2e` — real Chromium with the extension against public pull requests
- GitHub page assumptions live only in `src/selectors.ts`
- Test fixtures must come from public repositories or be handmade; the first line records the source and `test/fixtures.test.ts` checks it

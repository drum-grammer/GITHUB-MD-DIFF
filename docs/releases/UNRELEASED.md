# Unreleased — changes since 1.5.1

1.5.1 was submitted to the Chrome Web Store on 2026-10-14 ([notes](v1.5.1.md)). When the next version is submitted, its release notes (`pnpm release notes` → `docs/releases/vX.Y.Z.md`) start from this list; empty this file in the same pull request.

## New

- The local review command-line tool `markdown-diff-cat` (npm, same version number as the extension) — rendered Markdown diffs of your working tree in a local page, with block comments handed to coding agents. See [packages/review/README.md](../../packages/review/README.md).
- Local review: every rendered block carries Codex annotation attributes (file, side, lines, review render), and `show --side old|new` prints either side of a review render.

## Fixed

- When GitHub cannot build the rendered view of a Markdown file, you now get its source diff and the reason, instead of GitHub's error line followed by a collapsed **Load Diff**. GitHub's server times out (504, after about 10 seconds) on some large files and shows “This rich diff is not supported at the moment.”; the extension now goes back to the source view as soon as that message appears (it used to wait 15 seconds), loads the source diff even when GitHub hid it behind **Load Diff**, and puts a one-line note above it that says why, with **Try rich diff again**. Trying again is your choice, so the extension does not switch that file back if it fails again

## Internal — groundwork for a local review tool (no visible change)

- markdown-it 15 with its own TypeScript types (`@types/markdown-it` removed). Splitting Markdown into source blocks gives the same result as before on every Markdown file in this repository and on the test repository documents, and a snapshot test now pins it
- Shared modules split out without changing behavior: comment types (`src/types.ts`), the markup inside GitHub's rendered diff (`src/prose-markup.ts`), and the comment UI behavior (`src/comment-controller.ts`, with the GitHub requests left in `src/comments.ts`). Block alignment limits and the comment box buttons became options whose defaults are the current behavior
- The pnpm workspace has room for `packages/*`; the store package has the same files
- No new permissions

## How it was tested

- Unit tests 397 passed (351 before), including new tests that pin the GitHub comment flow with a fake GitHub: posting, a new commit while writing, a pending review, thread placement, the notice when threads cannot be shown
- Source blocks on 579 Markdown documents (every Markdown file in this repository plus each version of the test repository documents): identical with markdown-it 14 and 15
- Source-line matching on 7 pull requests (`scripts/mapping-report.mjs`): 5533/5537 (99.9%) before and 5533/5537 (99.9%) after; no file lost a matched block
- `pnpm verify pr` on `d8b7040`: 7 of 7 steps passed in 6 min (type check, unit tests, build, end-to-end tests with writes, canary, test repository setup, test repository Split)

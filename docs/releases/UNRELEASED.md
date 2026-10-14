# Unreleased — changes since 1.5.0

The store has 1.5.0 (published 2026-10-14). When the next version is submitted, its release notes (`pnpm release notes` → `docs/releases/vX.Y.Z.md`) start from this list; empty this file in the same pull request.

## 1.5.1 — works again on GitHub's signed-in "Files changed" page

- **Fixed:** on 2026-10-14 GitHub renamed the class names on its signed-in "Files changed" page, and 1.5.0 stopped rendering, folding and commenting there without saying anything. 1.5.1 finds files by their link address (`#diff-…`) and the page layout first, so a renamed class no longer stops it, and it still works if GitHub switches back. The signed-out page was not affected
- **New:** when the extension sees files on the page but cannot read any of them for a few seconds, it shows its warning (the **!** on the toolbar icon and a note in the corner with a prefilled "Report on GitHub" link) instead of doing nothing
- No new permissions

## How it was tested

- 2026-10-14, before the fix (1.5.0 against that day's GitHub): 6 signed-in end-to-end tests failed (a 7th runs only in write mode), canary 3 of 7 broken — every failure was "file not found"
- After the fix: unit tests 351 (the file tests run on three page formats: the old class names, the new ones, and none at all), signed-in end-to-end tests all passed, a new end-to-end test where the page's file ids and class names are removed shows the warning, canary 9 of 9 including the new "class name format" check
- `pnpm verify release` on `7ca3da6` (16 minutes): every test passed — end-to-end tests with writes 13, canary 9 of 9, the public test repository 60 of 60 in 5 GitHub diff layouts (real comments, replies, resolve, edit, delete, a 2,400-line diff, a 120-file pull request), 16 public pull requests re-explored with no warnings or extension errors and 99.8% of rendered blocks matched to source lines, extension CPU 89 ms and 255 ms on the two performance pull requests. The one red step was the harness itself (`pnpm -s typecheck` is not accepted by pnpm 12); fixed in `d12fbe4`, where `pnpm verify quick` passed 5 of 5 including the type check

# Unreleased — changes since 1.0.0

The store still has 1.0.0. 1.1.0 was withdrawn from review and 1.1.1 was never submitted. On 2026-10-09 the maintainer chose to keep improving and to use each build locally (`pnpm dev:chrome`) before the next review request. When that request is made, the release notes for that version (`pnpm release notes` → `docs/releases/vX.Y.Z.md`) start from this list. Delete this file in the same pull request.

## 1.1.1 (not submitted)

Everything in [docs/releases/v1.1.1.md](v1.1.1.md): comment in the rendered view, the #22 fix and the fixes from 300 public pull requests, faster large pull requests, footnotes defined mid-document.

## 1.2.0 — jump between changes

- The top of each rendered file says how many places changed and how many review threads it has, with how many are still open
- `]` / `[` go to the next or previous change on the page, `}` / `{` to the next or previous thread, ↑ ↓ move within one file. The keys do nothing while you type

## 1.3.0 — finish the review loop in the rendered view

- Comments on the whole file now show at the top of the file, where you can reply and resolve them. Before, they did not show at all
- Preview your comment the way GitHub will show it (mentions, issue links, code), from a Write / Preview tab
- Edit or delete your own comments in place. Delete asks for a second click
- Threads made outdated by a later commit stay out of the rendered view and out of the count, like on GitHub

## How it was tested (fill in from the latest `pnpm verify release` report)

- 1.3.0, 2026-10-09: see [docs/reports/v1.3.0-testing.md](../reports/v1.3.0-testing.md)

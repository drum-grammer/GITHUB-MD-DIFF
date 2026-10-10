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

## 1.4.0 — the comment box looks like GitHub's

- The box you comment in from the rendered view now looks like the one on GitHub's own diff: your avatar and a bold "Add a comment on line R13" (`L` for the removed side), the Write / Preview tabs on a bordered header, and the formatting toolbar in GitHub's order (heading, bold, italic, quote, code, link, bulleted, numbered and task lists, mention)
- The toolbar buttons and ⌘/Ctrl+B, I, E, K wrap or unwrap the selected text, and ⌘/Ctrl+Z undoes them
- A suggestion button, first in the toolbar like on GitHub, puts the lines you comment on into a ```` ```suggestion ```` block to edit (only on the new side, as on GitHub)
- Switching between bulleted, numbered and task lists replaces the list marker instead of stacking them
- **Comment** (was "Add single comment") and **Start a review** stay off until you type, like on GitHub. The edit box's **Save** does the same

## 1.5.0 — same as GitHub, in English

- Reply boxes in review threads get the same toolbar as GitHub's reply box, with the suggestion button first: it puts the lines the thread is on into a ```` ```suggestion ```` block
- The extension's text is now always in English, whatever language Chrome uses, so the comment box reads the same as GitHub's own pages, which are English only. Korean text is kept and will come back as a setting

## How it was tested (fill in from the latest `pnpm verify release` report)

- 1.3.0, 2026-10-09: see [docs/reports/v1.3.0-testing.md](../reports/v1.3.0-testing.md)
- 1.4.0, 2026-10-10: `pnpm verify release` 10/10 (testbed 60/60 in 5 layouts), extension CPU unchanged from 1.3.0 within noise — see [docs/reports/v1.4.0-testing.md](../reports/v1.4.0-testing.md)

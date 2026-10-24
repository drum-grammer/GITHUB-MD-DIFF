# Unreleased — changes since 1.7.0

1.7.0 went to npm and GitHub Releases on 2026-10-23 ([notes](v1.7.0.md)); the Chrome Web Store stays on 1.6.0 because the extension did not change. When the next version is submitted, its release notes (`pnpm release notes` → `docs/releases/vX.Y.Z.md`) start from this list; empty this file in the same pull request.

- Local review CLI `markdown-diff-cat`, pull request mode fixes:
  - Only one **Add to pending review** runs at a time (a second one is refused), and each comment leaves the drafts as soon as GitHub has it — an interrupted add no longer adds the rest twice
  - The confirm dialog stays open while adding (Cancel is off) and closes with Escape when idle
  - A reply whose GitHub thread is hidden (outdated) or could not be loaded shows on its own, so you can edit or delete it
  - A thread that spans from a removed line to an added line is placed at its last line
  - When GitHub sees a rename that git saw as delete + add, a comment on the removed side goes to the renamed file
  - The handoff's "excluded" count counts only the Markdown files on the page
  - `stop --clean` removes only the pull request refs this worktree fetched
- Manual checklists for Claude Code and Codex now cover pull request mode

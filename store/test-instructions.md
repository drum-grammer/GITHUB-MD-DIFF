# Test instructions for the reviewer

Paste into the dashboard → Test instructions. No account or sign-in is needed.

1. Install the extension and keep the toolbar icon pinned (color cat = on).
2. Open this public pull request (works signed out): https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/6/files
3. Within a few seconds `demo/design-doc.md` switches to the rendered view. Unchanged sections turn into thin bars such as "Unchanged · 9 blocks · last heading “5.1 Services”". Click a bar to expand that section.
4. Scroll to "8. Rollout plan". Instead of GitHub's whole old table plus whole new table, one table shows only the changed row (Phase 2: Planned → In progress) and the added row (Phase 4). Click "Original tables" to see GitHub's view, then "Merged table" to switch back.
5. Click the toolbar icon. The icon turns gray and the page returns to GitHub's original view. Click again to turn it back on.

It also works on any public pull request that changes a Markdown file, for example https://github.com/github/docs/pull/46149/files.

# Test instructions for the reviewer

Paste into the dashboard → Test instructions. Steps 1–5 need no account or sign-in. Step 6 (commenting) needs a GitHub account.

1. Install the extension and keep the toolbar icon pinned (color cat = on).
2. Open this public pull request (works signed out): https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/34/files
3. Within a few seconds `demo/intro/markdown-diff-cat.en.md` switches to the rendered view. Unchanged sections turn into thin bars such as "Unchanged · 6 blocks · last heading “5.1 Rendered diff with folding”". Click a bar to expand that section.
4. Scroll to "6. Feature overview". Instead of GitHub's whole old table plus whole new table, one table shows only the changed row ("Comment in the rendered view": — → 1.1, Planned → Stable) and the three added rows. Click "Original tables" to see GitHub's view, then "Merged table" to switch back.
5. Click the toolbar icon. The icon turns gray and the page returns to GitHub's original view. Click again to turn it back on.

6. Commenting (optional, needs a GitHub account): sign in to GitHub and open https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/34/changes. Hover over the paragraph under "5.2 Comment on the rendered document" and click the blue +. A comment box opens labeled "Add a comment on line R40". The first toolbar button (Add a suggestion) puts the original line into a suggestion block. Type a comment and click "Start a review": the comment appears under the paragraph marked "Pending", visible only to you until a review is submitted. To remove it, click "Delete" twice on the comment. Dragging from + to another block comments on a range of lines.

It also works on any public pull request that changes a Markdown file, for example https://github.com/github/docs/pull/46149/files.

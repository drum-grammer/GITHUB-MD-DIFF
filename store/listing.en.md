# Store listing — English

**Name** (from `_locales/en/messages.json`): Markdown Diff Cat for GitHub

**Summary** (manifest description, 132 characters max): Rendered Markdown diffs in GitHub pull requests: see only the changed parts and comment right on them.

**Category:** Developer Tools · **Language:** English

## Description

AI coding assistants write long design documents, and reviewing them in a pull request is painful.

• GitHub's rich diff renders the whole file, so you scroll past hundreds of unchanged lines to find what changed.
• The source diff shows only the changes, but they are buried in Markdown syntax, tables, and code fences.
• And to leave a review comment, you have to go back to the source diff.

Markdown Diff Cat gives you the rendered document with only the changes in view — and lets you comment right on it.

WHAT IT DOES
• Opens every Markdown file (.md, .markdown, .mdx) in the rendered view for you.
• Folds unchanged sections into one-line bars. Each bar shows how many blocks it hides and the last heading inside. Click a bar to peek, or expand the whole file.
• Tables: when one row changes, GitHub shows the whole old table and the whole new table. Markdown Diff Cat merges them into one table with only the changed, added, and removed rows, and shows changed cells as old → new. Switch to the original tables any time.
• Comment right in the rendered view (signed in to GitHub): hover over a block and click +, or drag to another block for a range. The comment lands on the right source line as an ordinary GitHub review comment — add a single comment or add it to your review. Existing review threads show under the block they refer to, where you can reply and resolve them. Comments on the whole file show at the top.
• The comment box works like GitHub's own: Write and Preview tabs, the same formatting toolbar and shortcuts, and a suggestion button that puts the original lines into a suggestion block so the author can apply your wording in one click. Reply boxes have it too.
• Edit or delete your own comments in place, and preview them the way GitHub will show them.
• Jump between changes: the top of each file says how many places changed and how many review threads are open. Press ] and [ for the next or previous change, } and { for threads.
• Stays out of your way: click <> to switch a file to the source view and it will not switch that file back. Collapsed or Viewed files stay collapsed.
• Color icon means on, gray icon means off. Click the toolbar icon to switch.
• The extension's text is in English, to match GitHub's pages.

Works on both the new and the classic pull request "Files changed" pages.

PRIVACY
No data collected and no remote code. It runs only on github.com. When you are signed in, it talks only to GitHub with the session you already have — to load review threads and the Markdown files on the page, and to post the comments you write. Nothing goes to the developer or anyone else, and no token is used. Your on/off setting stays on your device.

Unofficial. Not affiliated with or endorsed by GitHub. GitHub is a trademark of GitHub, Inc.

Source code: https://github.com/drum-grammer/GITHUB-MD-DIFF

# Markdown Diff Cat — Product Brief

> Status: Published for 1.0 · Owner: Markdown Diff Cat maintainers · Last updated: 2026-10-07

## 1. Overview

Markdown Diff Cat is a Chrome extension for reviewing Markdown in GitHub pull requests. It shows each Markdown file as a rendered document, keeps only the changed parts in view, and lets you leave review comments right on the rendered text.

This brief explains the problem it solves, what it does today, and what comes next. Share it with anyone who reviews design documents, READMEs, or runbooks in pull requests.

## 2. Why it exists

- AI coding assistants now write long design documents, and every edit lands in a pull request.
- GitHub's rich diff renders the whole file, so reviewers scroll past hundreds of unchanged lines.
- The source diff shows only the changes, but they are buried in Markdown syntax, tables, and code fences.

## 3. Who it is for

- Engineers who review design documents and RFCs written in Markdown.
- Technical writers who keep READMEs, guides, and changelogs up to date.
- Team leads who approve runbooks and process documents.
- Anyone who reviews pull requests that change more prose than code.

## 4. How a review looks without it

A reviewer opens a pull request that changes a 400-line design document. The rich diff shows the whole document with a few green and red highlights somewhere in the middle. To find them, the reviewer scrolls, loses the place, and scrolls again.

When the reviewer wants to comment, the rich diff has no comment button. The reviewer switches to the source diff, finds the same sentence among the Markdown syntax, and writes the comment there. Tables are worse: when one row changes, GitHub shows the whole old table and the whole new table one after the other.

## 5. What it does

### 5.1 Rendered diff with folding

Every Markdown file opens in the rendered view. Sections that did not change fold into a one-line bar that says how many blocks it hides and the last heading inside. Click a bar to peek, or expand the whole file at once.

### 5.2 Comment on the rendered document

Commenting is planned for a later version. For now, switch the file to the source diff to leave a review comment.

## 6. Feature overview

| Feature | Since | Where | Status |
|---|---|---|---|
| Rendered diff for Markdown files | 1.0 | Files changed | Stable |
| Fold unchanged sections | 1.0 | Files changed | Stable |
| Merge changed table rows | 1.0 | Files changed | Stable |
| Comment in the rendered view | — | — | Planned |

## 7. How it works

### 7.1 Finding the Markdown files

The extension watches the "Files changed" page and picks out every file that ends in .md, .markdown, or .mdx. It switches each one to GitHub's own rendered view, so the document looks exactly as it will after the merge. Files you switched to the source view yourself are left alone.

### 7.2 Folding what did not change

GitHub marks added, removed, and changed blocks in the rendered view. Everything between two marked blocks is unchanged, so the extension replaces that run of blocks with a single bar. The bar keeps the last heading it hides, which tells you where you are in the document without opening it.

Folding never removes anything from the page. Expanding a bar shows the original blocks again, and the expand-all button restores the whole file.

### 7.3 Merging tables

When a table changes, GitHub shows the old table and the new table one after the other. The extension compares them row by row and builds one table that keeps only the rows that changed. Cells that changed show the old and new value side by side, and added and removed rows keep GitHub's colors.

### 7.4 Staying out of your way

If you click the source button on a file, the extension takes that as your choice and does not switch the file back until you pick the rendered view again or reload. Files you collapsed or marked as viewed stay collapsed.

## 8. Install

Install it from the Chrome Web Store, then open any pull request that changes a Markdown file. There is nothing to configure.

To try a build that has not reached the store yet:

```sh
git clone https://github.com/drum-grammer/GITHUB-MD-DIFF.git
cd GITHUB-MD-DIFF
pnpm install && pnpm dev:chrome
```

Load the folder it prints with **Load unpacked** on `chrome://extensions`.

## 9. Privacy

- No data is collected and no remote code is loaded.
- It runs only on github.com.
- When you are signed in, it talks only to GitHub with the session you already have.
- Your on and off setting stays on your device.

## 10. Frequently asked questions

### 10.1 Does it change my pull request?

No. It changes only how the page looks in your browser. Comments you post are ordinary GitHub review comments.

### 10.2 Does it work on private repositories?

Yes. It reads the page you already have open, with your own session, and sends nothing anywhere else.

### 10.3 What if GitHub changes its page?

The toolbar icon shows `!` and commenting turns itself off, while folding and tables keep working. An update usually follows within days.

### 10.4 Does it slow GitHub down?

No. It looks at each file once, after GitHub has drawn it, and does not touch files it has already handled. On a pull request with 300 Markdown files it adds well under a second of work in total.

### 10.5 Can I turn it off for a moment?

Yes. Click the toolbar icon. It turns gray, and the page goes back to how GitHub draws it.

## 11. Roadmap

- Comment in the rendered view.
- Keyboard shortcuts to jump between changes.
- Commit and compare pages, in addition to pull requests.
- A side-by-side view for long rewrites.

## 12. Limits

- Files renamed without changes stay in the source view, since there is nothing to render.
- When an edit does not change how the page looks, such as a link URL, the file says so and offers the source diff.
- Blocks that GitHub draws from HTML or diagrams may not get a comment button.
- In a pull request with many Markdown files, files further down render as you scroll to them.

## 13. Appendix

### 13.1 Glossary

- **Rich diff** — GitHub's rendered view of a changed Markdown file.
- **Source diff** — the line-by-line view of the Markdown source.
- **Fold bar** — the one-line bar that stands in for unchanged blocks.

### 13.2 Links

- Source code and issues: github.com/drum-grammer/GITHUB-MD-DIFF
- Privacy policy: PRIVACY.md in the repository

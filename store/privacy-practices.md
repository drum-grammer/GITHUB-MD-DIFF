# Privacy practices tab — answers

Copy these into the Chrome Web Store developer dashboard → Privacy practices.

## Single purpose

Review Markdown file changes in GitHub pull requests as rendered diffs: it opens the rendered view, folds unchanged sections, shows only the changed rows of tables, and lets the signed-in user comment on the rendered blocks as GitHub review comments.

## Permission justification

| Permission | Justification |
|---|---|
| `storage` | Remembers whether the extension is turned on or off (one boolean in `chrome.storage.local`). Nothing else is stored. |
| Host permission `https://github.com/*` (content script) | The content script runs on GitHub pull request "Files changed" pages to switch Markdown files to the rendered diff, fold unchanged sections, and merge changed tables. When the user is signed in, it also uses GitHub's own same-site requests, with the user's existing session, to load the pull request's review threads and Markdown files and to post the review comments the user writes. It checks the URL and does nothing on other GitHub pages. It does not run on any other site. |

## Remote code

**No, I am not using remote code.** All JavaScript is bundled in the package. The only requests go to github.com (GitHub's own pages, as GitHub's page makes them) and return data, never code.

## Data usage

Collected data types: **none** (leave every category unchecked). The extension reads the open GitHub page inside the browser to change how it is displayed. When the signed-in user writes a review comment, the text goes straight from the browser to GitHub — the site the user is using — to post it there, exactly as GitHub's own comment box would. The developer receives no data, and nothing goes to any third party.

> Review before submitting a version with commenting (1.1.x): if Chrome Web Store asks to declare data that the extension sends to the site the user is on, check **Website content** with the same explanation. Mihiraki, which also posts GitHub review comments from the rendered view, declares no data collection on its store page (checked 2026-10-08).

Certify all three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

## Privacy policy URL

https://github.com/drum-grammer/GITHUB-MD-DIFF/blob/main/PRIVACY.md

# Privacy practices tab — answers

Copy these into the Chrome Web Store developer dashboard → Privacy practices.

## Single purpose

Shows Markdown file changes in GitHub pull requests as rendered diffs: it opens the rendered view, folds unchanged sections, and shows only the changed rows of tables.

## Permission justification

| Permission | Justification |
|---|---|
| `storage` | Remembers whether the extension is turned on or off (one boolean in `chrome.storage.local`). Nothing else is stored. |
| Host permission `https://github.com/*` (content script) | The content script runs on GitHub pull request "Files changed" pages to switch Markdown files to the rendered diff, fold unchanged sections, and merge changed tables. It checks the URL and does nothing on other GitHub pages. It does not run on any other site. |

## Remote code

**No, I am not using remote code.** All JavaScript is bundled in the package; the extension makes no network requests.

## Data usage

Collected data types: **none** (leave every category unchecked). The extension reads the open GitHub page only inside the browser to change how it is displayed and never transmits it.

Certify all three statements:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

## Privacy policy URL

https://github.com/drum-grammer/GITHUB-MD-DIFF/blob/main/PRIVACY.md

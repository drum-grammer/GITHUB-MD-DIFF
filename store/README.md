# Chrome Web Store kit

Everything needed to publish or update the [listing](https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj).

To announce the extension in a chat or post, start from [sharing.md](sharing.md): links, ready-to-paste messages, and what to tell people about the "Proceed with caution" warning.

| Dashboard field | Source |
|---|---|
| Package | `pnpm package` → `release/markdown-diff-cat-for-github-<version>.zip` |
| Name, summary | `static/_locales/<lang>/messages.json` (`extName`, `extDescription`) |
| Description | [`listing.en.md`](listing.en.md), [`listing.ko.md`](listing.ko.md) |
| Icon | in the package (`icons/icon128.png`, 96 px artwork + 16 px padding) |
| Screenshots (1280×800) | `images/<lang>/screenshot-1.png` … `screenshot-5.png` (store maximum 5) |
| Small promo tile (440×280) | `images/<lang>/promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `images/<lang>/promo-marquee-1400x560.png` |
| Privacy practices | [`privacy-practices.md`](privacy-practices.md) |
| Privacy policy URL | `PRIVACY.md` on GitHub |
| Test instructions | [`test-instructions.md`](test-instructions.md) |
| Category | Developer Tools |

## Regenerating the images

`pnpm store:assets` builds the extension, captures the demo pull request for each language with and without the extension. The demo comes from [`store/demos/`](demos/README.md): one folder per version of the store images with the before and after documents, the pull requests, and what the capture looks for (highest version by default, `DEMO_VERSION=v1.0.0` to pick another; new demos with `pnpm store:demo create`). For 1.5.0 that is the extension's own product brief updated from 1.0 to 1.5 (English #34, Korean #35), and composes the screenshots, promo tiles, and `docs/demo.gif`. It needs the signed-in test profile (`pnpm e2e:login`), because GitHub shows the new "Files changed" page only to signed-in users. Captures cover only the file area, so no account details appear. The commenting scene (screenshot 2) posts a comment as a pending review on the demo pull request and fills a second box through the suggestion button, which only you can see, and deletes the review with `gh` afterwards (needs `gh` signed in as the repository owner). Five screenshots per language: 1 overview, 2 commenting with a suggestion, 3 folding, 4 tables, 5 stays out of your way. The demo documents live on the branches `demo/intro-base`, `demo/intro-en`, and `demo/intro-ko`. ([#6](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/6), an unrelated checkout design document, was the demo up to 1.1.0.)

## Filling in the dashboard

The developer dashboard cannot be automated: Chrome blocks every extension from scripting Chrome Web Store pages, and embedded browsers do not load it. Enter it by hand with the helper:

1. `pnpm package && pnpm store:upload`
2. `release/store-upload/` now holds every file to upload, numbered in dashboard order (package, store icon, then `en-*` and `ko-*` screenshots and promo tiles), plus `guide.html`
3. Open `guide.html` next to the dashboard. It lists the steps in dashboard order with a **Copy** button for every text field. The text comes from the files in this folder

## Versioning

[Semantic Versioning](https://semver.org/), `MAJOR.MINOR.PATCH`. The same number goes in `static/manifest.json`, `package.json` (a test checks that they match), the git tag `vX.Y.Z`, and the GitHub Release.

| Bump | When | Example |
|---|---|---|
| PATCH | Bug fixes and keeping up with GitHub page changes. Nothing new for people to learn | A selector stops matching after a GitHub redesign |
| MINOR | New features or newly supported pages, without new permissions | Supporting the commit or compare pages |
| MAJOR | New permissions or site access, because Chrome disables the extension until each person accepts them. Also removing or changing behavior people rely on | Running on `gist.github.com` too |

- Changes to docs, store listing text or images, tests, or tooling leave the package unchanged, so they get no new version. Update the listing in the dashboard without uploading a package.
- The store accepts only a package with a higher version than the published one.
- Tags start at `v1.0.0`, the first public release. `0.1.0` was a private developer-mode build and has no tag.

## Releasing an update

`pnpm release` runs each step against the [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api). It uploads the package and submits it; listing text and images still go through the dashboard.

**One-time setup:** in Google Cloud, enable the Chrome Web Store API and create a service account (no roles needed), then create a JSON key for it. Put the whole JSON in the environment variable `CWS_SERVICE_ACCOUNT_KEY`, and keep the key file out of the repository. In the developer dashboard, add the service account's email under **Account** (one per publisher). Publishing needs 2-step verification on the publisher account. `pnpm release status` confirms access. If the publisher ID differs from the one in `scripts/cws.mjs`, set `CWS_PUBLISHER_ID`.

1. Bump `version` in `static/manifest.json` and `package.json` following [Versioning](#versioning), and merge to `main`.
2. On `main`, run the full verification tier first: `pnpm verify release` (about 16 to 18 minutes: unit, typecheck, e2e with writes, canary, the release scenarios on the public test repository in all five GitHub diff layouts, a re-exploration of 16 public pull requests, performance, and the package; everything must pass, see [Verification tiers](../README.md#verification-tiers) and [testbed/README.md](../testbed/README.md)). `check` does not run the scenarios, because they need `gh` and the signed-in test profile and post real comments. Then `pnpm release check`: tests, typecheck, e2e (`--no-e2e` skips it and says so in the record), then `pnpm package`. It keeps the record (version, commit, zip SHA-256) and the zip itself in `~/.local/share/github-md-diff/releases/<version>/` (set `GMD_RELEASE_DIR` to change it), outside the repository, because review takes days and the last step usually runs in another session. Do steps 2 to 8 on one machine. It also tells you if the listing text or images differ from the last tag. Once a version has been uploaded, `check` will not replace its record; `--redo` does, keeping the old files under new names, for when a cancelled review is resubmitted with the same version.
3. If the listing differs: `pnpm store:upload`, enter the changed fields in the dashboard, and save the draft.
   - If a review was cancelled and the draft already holds a newer listing than the last tag, compare against the commit that listing came from: `node scripts/store-upload.mjs --since <commit>`
4. Release notes, written before submission and kept in the repo: `pnpm release notes` starts `docs/releases/vX.Y.Z.md` with the recorded commit and zip SHA-256. Write what changed for people, any permission change, and how it was tested, including the line `pnpm testbed:report` prints (see v1.1.1). A release with substantial testing also gets a report in `docs/reports/`. Remove the marker line and merge it to `main`.
5. `pnpm release upload` uploads the recorded zip as a draft. Nothing is public yet.
6. `pnpm release submit --confirm X.Y.Z` (add `--listing-done` after step 3) submits it for review, and the store publishes it automatically once approved. Add a row to the submission log.
7. `pnpm release status` shows the local record and the published and pending versions.
8. Once it is published: `pnpm release finish --confirm X.Y.Z`. It checks that the store published this version, that the zip is the one uploaded, and that `docs/releases/vX.Y.Z.md` on `main` is final and names the zip's SHA-256. Then it tags the recorded commit `vX.Y.Z`, pushes the tag, and publishes a GitHub Release with that zip and those notes. If it stops after pushing the tag, running it again continues. Then update the row's status.

If the API is unavailable, the dashboard still works: Package → Upload new package → Submit for review. Then tag and release by hand:

```bash
git tag -a vX.Y.Z <commit> -m "Markdown Diff Cat for GitHub X.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z release/markdown-diff-cat-for-github-X.Y.Z.zip --title "X.Y.Z" --notes-file docs/releases/vX.Y.Z.md
```

## Submission log

| Version | Date | What | Status |
|---|---|---|---|
| 1.6.0 | 2026-10-22 | Markdown files GitHub cannot render (its server answers the rendered-view request with a 504 after about 10 seconds and shows “This rich diff is not supported at the moment.”) are rendered in the browser with the local review engine ([#52](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/52), [design](../docs/local-render/README.md)); if that fails too, the source diff is shown with the reason ([#51](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/51)). The local review CLI `markdown-diff-cat` shares the version number (npm release separate) ([notes](../docs/releases/v1.6.0.md)). `pnpm verify release` on `8b9f739`: 13 of 13 steps passed, including the public test repository 60 of 60 in 5 layouts. Package uploaded and submitted through the Chrome Web Store API (`pnpm release upload`, `pnpm release submit`) from `8b9f739` (SHA-256 `d04e7a6de39907f4955d769afa97aee93216348137718eb674cad55f60c8420f`), `release check` with its end-to-end step. Listing unchanged. No new permissions | Published, public (`pnpm release status`: PUBLISHED, confirmed 2026-10-22, about 20 minutes after submission; listing shows 1.6.0). Tag [`v1.6.0`](https://github.com/drum-grammer/GITHUB-MD-DIFF/releases/tag/v1.6.0) on `8b9f739` and GitHub Release (Latest) with the same zip and the local review CLI file `markdown-diff-cat-1.6.0.mjs` (`node scripts/release-review.mjs attach`). npm [`markdown-diff-cat@1.6.0`](https://www.npmjs.com/package/markdown-diff-cat): first npm release, published 2026-10-22 by the maintainer from their own terminal (`release-review publish`). npm refused it until two-factor authentication was turned on for the account (403), then asked for browser approval; it answered 202 and showed only its `0.0.0-stage` placeholder for about 7 minutes before 1.6.0 became `latest`. `npx -y markdown-diff-cat@1.6.0 --version` prints 1.6.0 |
| 1.5.1 | 2026-10-14 | Fix for GitHub's 2026-10-14 class name change on the signed-in "Files changed" page, which stopped 1.5.0 there; files are found by their anchor id and page structure first, both class formats are accepted, and the extension warns when it cannot read any file ([notes](../docs/releases/v1.5.1.md), [report](../docs/reports/v1.5.1-github-class-names.md)). Package uploaded and submitted through the Chrome Web Store API (`pnpm release upload`, `pnpm release submit`) from `0873956` (SHA-256 `fa442a56e459d397dc1bec308e70fb654eeb8465a290274f5178bc77e60d5447`). `release check` ran without its end-to-end step (a new test raced GitHub's lazy file drawing; fixed and passed on the same code). Listing unchanged. No new permissions | Published, public (`pnpm release status`: PUBLISHED, confirmed 2026-10-15; listing shows 1.5.1, updated October 14, 2026). Tag [`v1.5.1`](https://github.com/drum-grammer/GITHUB-MD-DIFF/releases/tag/v1.5.1) on `0873956` and GitHub Release (Latest) with the same zip; v1.5.0 stays a pre-release because it stopped on the signed-in page |
| 1.5.0 | 2026-10-13 | First store update since 1.0.0: everything in 1.1.1 to 1.5.0 ([notes](../docs/releases/v1.5.0.md)) — comment in the rendered view, a comment box that works like GitHub's with a suggestion button (also in replies), edit, delete and preview, jumping between changes, and the extension's text in English. Package uploaded through the Chrome Web Store API (`pnpm release upload`) from `4ba51b3` (SHA-256 `c1077b8c81895ba079d89f766fcbc319331897dd16591cd174155e9bd670f9b1`). Listing: new descriptions (en, ko), 5 screenshots per language and both promo tiles from the product-brief demo pull requests ([#34](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/34), [#35](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/35)), new test instructions; privacy practices unchanged except the single purpose and justifications re-entered. The dashboard first said the privacy policy link could not be reached; saving the draft again cleared it (GitHub answers some Google fetchers with 503). Submitted from the dashboard. No new permissions | Published, public (`pnpm release status`: PUBLISHED, confirmed 2026-10-14). Does nothing on the signed-in "Files changed" page because of GitHub's class name change that day — fixed in 1.5.1 |
| 1.1.1 | 2026-10-08 | Everything in 1.1.0, plus fixes from [#22](https://github.com/drum-grammer/GITHUB-MD-DIFF/issues/22) and a read-only exploration of 300 Markdown pull requests in 128 public repositories (`pnpm explore`): a file GitHub cannot render goes back to the source view instead of raising `!` and an issue link; no false `!` for files GitHub has not loaded yet or shows only behind Load Diff; renamed files keep their comments and **+**; at most 10 rendered views requested at a time, files on screen first, with no long main-thread pauses in a 334-file pull request; a note when an edit does not change the rendered result; folding stays inside a GitHub unchanged group that has a review thread; HTML blocks, GitHub alerts, and footnotes (also ones defined mid-document) match their source lines; the selected range keeps GitHub's yellow highlight while the comment box is open; in large pull requests the extension's own CPU time drops by about 80% (`pnpm perf`: 1,182 → 220 ms over 25 s with 334 Markdown files), and folding still lands in the same frame as GitHub's rendered diff. Release scenarios on the public test repository pass 14/14 (`pnpm testbed`). Package built from `e52b4cb` (SHA-256 `e922f26d4ae6d97dafbc9e397fbf12952bb49b7a1be26cc197661c72ee685ebe`). It replaces the earlier 1.1.1 build from `662805e`. Listing and images unchanged from the 1.1.0 draft (`node scripts/store-upload.mjs --since c0344f6`): upload the package only. No new permissions | Not submitted. On 2026-10-09 the maintainer chose to keep improving in 1.2.x and use each build locally (`pnpm dev:chrome`) before asking for review; the next submission includes everything in 1.1.1 |
| 1.1.0 | 2026-10-08 | Comment in the rendered view (+ on hover, drag for a range, single comment or review), review threads under their blocks with reply and resolve, files with threads open rendered when signed in; commenting turns itself off and offers a prefilled issue link if GitHub changes its requests. Package built from `6b3bb65` (SHA-256 `73a5008a6565ce20f9caac9438ffd9175807a2726caba74d46a85a6cf9fbcd87`). Listing: summary without the unofficial note, new description intro, 5 screenshots per language (new 2: commenting), new global marquee tile; privacy practices and test instructions updated, test account left blank. No new permissions | Review cancelled (2026-10-08) after [#22](https://github.com/drum-grammer/GITHUB-MD-DIFF/issues/22); replaced by 1.1.1, never published |
| 1.0.0 | 2026-10-07 | First submission: English and Korean listings, 4 screenshots and 2 promo tiles per language, public, all regions, publish automatically after review | Published, public ([listing](https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj), checked 2026-10-08) · [v1.0.0](https://github.com/drum-grammer/GITHUB-MD-DIFF/releases/tag/v1.0.0) |

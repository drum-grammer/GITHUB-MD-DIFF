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

`pnpm store:assets` builds the extension, captures the demo pull request ([#6](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/6), never merged) with and without the extension, and composes the screenshots, promo tiles, and `docs/demo.gif`. It needs the signed-in test profile (`pnpm e2e:login`), because GitHub shows the new "Files changed" page only to signed-in users. Captures cover only the file area, so no account details appear. The commenting scene (screenshot 2) posts two comments as a pending review on the demo pull request, which only you can see, and deletes the review with `gh` afterwards (needs `gh` signed in as the repository owner). Five screenshots per language: 1 overview, 2 commenting, 3 folding, 4 tables, 5 stays out of your way.

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
2. `pnpm release check` on `main`: tests, typecheck, e2e (`--no-e2e` skips it and says so in the record), then `pnpm package`. It keeps the record (version, commit, zip SHA-256), the zip itself, and later the release notes in `~/.local/share/github-md-diff/releases/<version>/` (set `GMD_RELEASE_DIR` to change it), outside the repository, because review takes days and the last step usually runs in another session. Do steps 2 to 7 on one machine. It also tells you if the listing text or images differ from the last tag. Once a version has been uploaded, `check` will not replace its record; `--redo` does, keeping the old files under new names, for when a cancelled review is resubmitted with the same version.
3. If the listing differs: `pnpm store:upload`, enter the changed fields in the dashboard, and save the draft.
   - If a review was cancelled and the draft already holds a newer listing than the last tag, compare against the commit that listing came from: `node scripts/store-upload.mjs --since <commit>`
4. `pnpm release upload` uploads the recorded zip as a draft. Nothing is public yet.
5. `pnpm release submit --confirm X.Y.Z` (add `--listing-done` after step 3) submits it for review, and the store publishes it automatically once approved. Add a row to the submission log and merge it to `main`.
6. `pnpm release status` shows the local record and the published and pending versions.
7. Once it is published: `pnpm release notes` writes a draft of the release notes from the submission log row on `main`. Rewrite it for people (what changed, any permission change, as in v1.0.0), remove the marker line, then run `pnpm release finish --confirm X.Y.Z`. It checks that the store published this version and that the zip is the one uploaded, tags the recorded commit `vX.Y.Z`, pushes the tag, and publishes a GitHub Release with that zip. If it stops after pushing the tag, running it again continues. Then update the row's status.

If the API is unavailable, the dashboard still works: Package → Upload new package → Submit for review. Then tag and release by hand:

```bash
git tag -a vX.Y.Z <commit> -m "Markdown Diff Cat for GitHub X.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z release/markdown-diff-cat-for-github-X.Y.Z.zip --title "X.Y.Z" --notes-file <notes.md>
```

## Submission log

| Version | Date | What | Status |
|---|---|---|---|
| 1.1.1 | 2026-10-08 | Everything in 1.1.0, plus fixes from [#22](https://github.com/drum-grammer/GITHUB-MD-DIFF/issues/22) and a read-only exploration of 300 Markdown pull requests in 128 public repositories (`pnpm explore`): a file GitHub cannot render goes back to the source view instead of raising `!` and an issue link; no false `!` for files GitHub has not loaded yet or shows only behind Load Diff; renamed files keep their comments and **+**; at most 10 rendered views requested at a time, files on screen first, with no long main-thread pauses in a 334-file pull request; a note when an edit does not change the rendered result; folding stays inside a GitHub unchanged group that has a review thread; HTML blocks, GitHub alerts, and footnotes match their source lines; the selected range keeps GitHub's yellow highlight while the comment box is open; in large pull requests the extension's own CPU time drops by about 80% (`pnpm perf`: 1,182 → 220 ms over 25 s with 334 Markdown files), and folding still lands in the same frame as GitHub's rendered diff. Package built from `662805e` (SHA-256 `48a428e61d11b9e8eaf449dc337a0c451e8cba2e86febab61541bf9db9c603b8`). Listing and images unchanged from the 1.1.0 draft (`node scripts/store-upload.mjs --since c0344f6`): upload the package only. No new permissions | Not submitted yet |
| 1.1.0 | 2026-10-08 | Comment in the rendered view (+ on hover, drag for a range, single comment or review), review threads under their blocks with reply and resolve, files with threads open rendered when signed in; commenting turns itself off and offers a prefilled issue link if GitHub changes its requests. Package built from `6b3bb65` (SHA-256 `73a5008a6565ce20f9caac9438ffd9175807a2726caba74d46a85a6cf9fbcd87`). Listing: summary without the unofficial note, new description intro, 5 screenshots per language (new 2: commenting), new global marquee tile; privacy practices and test instructions updated, test account left blank. No new permissions | Review cancelled (2026-10-08) after [#22](https://github.com/drum-grammer/GITHUB-MD-DIFF/issues/22); replaced by 1.1.1, never published |
| 1.0.0 | 2026-10-07 | First submission: English and Korean listings, 4 screenshots and 2 promo tiles per language, public, all regions, publish automatically after review | Published, public ([listing](https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj), checked 2026-10-08) · [v1.0.0](https://github.com/drum-grammer/GITHUB-MD-DIFF/releases/tag/v1.0.0) |

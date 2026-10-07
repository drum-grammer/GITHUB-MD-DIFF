# Chrome Web Store kit

Everything needed to publish or update the [listing](https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj).

| Dashboard field | Source |
|---|---|
| Package | `pnpm package` → `release/markdown-diff-cat-for-github-<version>.zip` |
| Name, summary | `static/_locales/<lang>/messages.json` (`extName`, `extDescription`) |
| Description | [`listing.en.md`](listing.en.md), [`listing.ko.md`](listing.ko.md) |
| Icon | in the package (`icons/icon128.png`, 96 px artwork + 16 px padding) |
| Screenshots (1280×800) | `images/<lang>/screenshot-1.png` … `screenshot-4.png` |
| Small promo tile (440×280) | `images/<lang>/promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `images/<lang>/promo-marquee-1400x560.png` |
| Privacy practices | [`privacy-practices.md`](privacy-practices.md) |
| Privacy policy URL | `PRIVACY.md` on GitHub |
| Test instructions | [`test-instructions.md`](test-instructions.md) |
| Category | Developer Tools |

## Regenerating the images

`pnpm store:assets` builds the extension, captures the demo pull request ([#6](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/6), never merged) with and without the extension, and composes the screenshots, promo tiles, and `docs/demo.gif`. It needs the signed-in test profile (`pnpm e2e:login`), because GitHub shows the new "Files changed" page only to signed-in users. Captures cover only the file area, so no account details appear.

## Filling in the dashboard

The developer dashboard cannot be automated: Chrome blocks every extension from scripting Chrome Web Store pages, and embedded browsers do not load it. Enter it by hand with the helper:

1. `pnpm package && pnpm store:upload`
2. `release/store-upload/` now holds every file to upload, numbered in dashboard order (package, store icon, then `en-*` and `ko-*` screenshots and promo tiles), plus `guide.html`
3. Open `guide.html` next to the dashboard. It lists the steps in dashboard order with a **Copy** button for every text field. The text comes from the files in this folder

## Releasing an update

1. Bump `version` in `static/manifest.json` and `package.json`.
2. `pnpm test && pnpm e2e && pnpm package`.
3. Dashboard → Package → Upload new package → Submit for review. Re-enter listing text or images only when they change (`pnpm store:upload` for the helper).

## Submission log

| Version | Date | What | Status |
|---|---|---|---|
| 1.0.0 | 2026-10-07 | First submission: English and Korean listings, 4 screenshots and 2 promo tiles per language, public, all regions, publish automatically after review | Published, public ([listing](https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj), checked 2026-10-08) |

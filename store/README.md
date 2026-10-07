# Chrome Web Store kit

Everything needed to publish or update the listing.

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

`pnpm store:assets` builds the extension, captures the demo pull request ([#6](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/6), never merged) with and without the extension, and composes the screenshots, promo tiles, and `docs/demo.gif`. It needs a signed-in test profile while the repository is private (`pnpm e2e:login`). Captures cover only the file area, so no account details appear.

## Releasing an update

1. Bump `version` in `static/manifest.json` and `package.json`.
2. `pnpm test && pnpm e2e && pnpm package`.
3. Dashboard → Package → Upload new package → Submit for review.

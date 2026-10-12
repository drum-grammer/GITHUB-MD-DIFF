# Demo pull requests — store screenshots by version

The extension only runs on a pull request's "Files changed" page, so every store screenshot needs a real pull request that changes a Markdown document. This folder keeps, for each version of the store images, the documents before and after the change, the pull requests made from them, and what the capture script looked for. The images themselves stay in `store/images/<lang>/`; their history is in git (the commits are listed below).

스토어 스크린샷은 실제 PR의 "Files changed" 화면을 찍어요. 이 폴더에는 버전마다 그 PR을 만든 문서(전·후), PR 번호, 캡처가 찾은 제목·문단·코멘트를 남겨요. 그림은 `store/images/<lang>/`에 있고, 버전별 그림은 아래 커밋에서 볼 수 있어요.

## History

| Version folder | Document | Pull requests | Images (commit) | Notes |
|---|---|---|---|---|
| [v1.0.0](v1.0.0/) | Checkout Service v2 design document (unrelated to the extension) | [#6](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/6) (both languages) | 1.0.0 `7425a17` · 1.1.0 `46a9b14`, `c361ff3` | Korean images used the same English pull request |
| [v1.5.0](v1.5.0/) | The extension's own product brief, 1.0 → 1.5 | en [#34](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/34) · ko [#35](https://github.com/drum-grammer/GITHUB-MD-DIFF/pull/35) | 1.5.0 `4ba51b3` | Reviewer test instructions point at #34. Both pull requests were later merged into their demo base branch; the files here are the versions that were captured |

The 1.6 proposal that briefly sat on #35 is in [docs/proposals/2026-10-12-ai-next.ko.md](../../docs/proposals/2026-10-12-ai-next.ko.md).

## Files in a version folder

- `demo.json`
  - `about`, `usedFor`, `baseBranch`
  - per language: `pr`, `branch`, `path` (the file path inside the demo pull request), `base` and `head` (the files in this folder), `heading`, `para`, `next` (text the capture script looks for in the comment scene), `comments` (the thread comment and the comment-box text)
- the documents named by `base` and `head`

## Making a new demo (when the screenshots need new content)

1. Copy the latest folder to a new version folder, for example `store/demos/v1.6.0/`. Edit the documents. Only show features that are released. Set `version`, `about`, `usedFor`, the texts the capture looks for, and the comments. Remove `pr` and `branch`.
2. Run `pnpm store:demo check v1.6.0`. It checks that the before and after documents differ and that the heading and paragraphs exist in the after document.
3. Run `pnpm store:demo create v1.6.0 --dry-run`, then run it without `--dry-run`. It branches `demo/v1.6.0/base` from `origin/main` with the before documents, then one `demo/v1.6.0/<lang>` branch per language with the after document. It opens a draft pull request for each and writes the pull request numbers into `demo.json`. Earlier demo branches and pull requests stay as they are.
4. Capture with `DEMO_VERSION=v1.6.0 pnpm store:assets`. Without `DEMO_VERSION`, the highest version folder is used.
5. Commit the folder, the images, and a new row in the table above in one pull request. Update `store/test-instructions.md` if the reviewer steps change.

Never merge a demo pull request. The capture needs its diff, and merging moves the demo base.

`pnpm store:demo list` shows every version and the state of its pull requests.

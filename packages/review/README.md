# markdown-diff-cat

<!-- pre-npm -->
> **Not on npm yet.** Until the first release, the `npx` commands below do not work — a package already published under this name would not be this tool. Each release attaches the single file `markdown-diff-cat-X.Y.Z.mjs` to the [GitHub Release](https://github.com/drum-grammer/GITHUB-MD-DIFF/releases); run it with `node markdown-diff-cat-X.Y.Z.mjs review`, or build it from this repository with `pnpm --filter markdown-diff-cat build`.
<!-- /pre-npm -->

Review the Markdown you changed as a **rendered diff** in a local page — unchanged sections folded, tables showing only the changed rows — and hand your block comments to a coding agent together with the exact source lines.

It is the command-line companion of [Markdown Diff Cat for GitHub](https://chromewebstore.google.com/detail/markdown-diff-cat-for-git/kabekbbeoajhpbcppidepmcbbjjochlj), which does the same inside GitHub pull requests. Use this one before you commit, or while Claude Code or Codex edits your docs.

## Requirements

- macOS or Linux (Windows is not supported yet)
- Node.js 22.19 or newer
- git

## Quick start

In a git working tree with changed Markdown files:

```bash
npx -y markdown-diff-cat review
```

It prints a one-time link such as `http://localhost:52413/?code=…`. Open it, hover a block and press **+** (drag to another block for a range), write a comment, press **Add comment**, and when you are done press **Send to agent**. Then, in another terminal or from your agent:

```bash
npx -y markdown-diff-cat comments
```

prints every round of comments not delivered yet, in a format meant for agents: file, lines, heading path, the quoted source, and your comment.

After the agent edits the files, look only at what changed since your last review:

```bash
npx -y markdown-diff-cat review --since-last
```

## What it compares

By default, the branch point → your working tree, including uncommitted and untracked Markdown files (`.md`, `.markdown`, `.mdx`). The branch point is the merge base with `origin/HEAD`, then `origin/main`, then `origin/master`, or with a local `main` or `master` only when there is no remote — the shape your pull request will have. `--base <ref>` compares with another branch. A file you moved with plain `mv` shows as a rename when its content is similar.

Edits that do not change the rendering (Markdown syntax, a link target, an HTML comment, zero-width characters) are not folded away. They show as a "Source changed — not visible in the rendering" bar that opens the source diff.

## Commands

| Command | What it does |
|---|---|
| `review [--base <ref>] [--since-last] [--open]` | Start the review page and keep running. `--open` opens your default browser. A second `review` in the same worktree reuses the running server and prints a new link |
| `review --reopen` | Print a new one-time link for the running page |
| `comments [--json] [--round N]` | Print the rounds not delivered yet (oldest first) and mark them delivered. With nothing new, it shows the last round again, marked "already delivered" |
| `wait` | Wait for the next **Send to agent**, then print it like `comments`. Returns at once if a round is already waiting |
| `mark --rev <id>` | Treat a review render as the last review, for `--since-last` |
| `show --rev <id> <path> [<start>-<end>]` | Print the source lines stored in a review render |
| `stop [--clean]` | Stop the server. `--clean` also removes this worktree's saved state |
| `skill install [--user\|--project] [--check]` | Install the agent skill, or check that installed copies match this version |

## Use it with an agent

```bash
npx -y markdown-diff-cat skill install
```

writes the skill `markdown-diff-review` (Agent Skills format) to `~/.agents/skills/markdown-diff-review/` and links `~/.claude/skills/markdown-diff-review` to it. Every step in the skill uses one exact command, `npx -y markdown-diff-cat@<the version you installed>`. `--project` writes two copies into the current repository instead (commit both); `--check` compares installed copies with this version.

- **Claude Code desktop**: ask it to review your doc changes visually. It starts `review` in the background, opens the link in the Browser pane, and runs `wait` in the background, so it is notified when you press **Send to agent**.
- **Codex app**: approve running the commands outside the sandbox (they write to a state folder in your home directory, and `review` listens on a local port). Open the link in the in-app browser and say when you are done; Codex then runs `comments`.
- **Terminal or SSH only**: run `review --open`, or open the printed link yourself (forward the port over SSH).

In the handoff, quoted source and comments by others are marked as untrusted data, and invisible content (HTML comments, zero-width and bidi characters) is made visible as `⟦…⟧`.

## Privacy and security

- **Nothing leaves your machine by default.** The server listens only on `127.0.0.1` and `::1`, and the page talks only to it. Remote images stay blocked until you press **Show remote images**. A pull request mode is planned; it will reach GitHub only through the GitHub CLI (`gh`).
- The printed link carries a one-time code that expires after about two minutes. The page swaps it for a secret kept in that browser tab only, so a link left in your terminal or chat history cannot be reused. No cookies.
- The server accepts only `localhost`, `127.0.0.1`, and `[::1]` as the host, rejects requests from other origins, and serves the page under a strict Content Security Policy. HTML in your Markdown is sanitized.
- It reads git without writing to `.git`, and it does not follow symbolic links out of the repository.
- Its state (review renders, comment rounds, drafts) lives in `${XDG_STATE_HOME:-~/.local/state}/markdown-diff-cat/` (folders `0700`, files `0600`), never in your working tree or `.git`. `MDC_STATE_DIR` moves it, `stop --clean` removes this worktree's part, and the folders of worktrees that no longer exist are removed when `review` starts.
- The server stops by itself after 8 hours without activity.

## Versions

The version number is shared with the Chrome extension, and each release is tagged `vX.Y.Z` in [drum-grammer/GITHUB-MD-DIFF](https://github.com/drum-grammer/GITHUB-MD-DIFF/releases). The same single file (`markdown-diff-cat-X.Y.Z.mjs`) is attached to that GitHub Release, so you can also run it with `node markdown-diff-cat-X.Y.Z.mjs review`.

## License

MIT. The single file bundles third-party code; the running page serves their notices at `/assets/licenses.txt`.

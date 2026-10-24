# Codex app — manual checklist (markdown-diff-cat, annotations)

Run this on macOS with the ChatGPT desktop app (Codex) before the annotations pull request is merged. Fill in the results table at the end and paste it into the pull request. It answers three open questions in the design: whether annotations work on `localhost` and `127.0.0.1`, whether the page's strict CSP (`script-src 'self'`) keeps the annotation API available, and how the Codex sandbox treats the commands.

## Setup

- [ ] Build: `pnpm --filter markdown-diff-cat build`. Note the absolute path of `packages/review/dist/markdown-diff-cat.mjs` (below: `<mdc>`)
- [ ] Make a scratch repository with one committed Markdown file, then change a paragraph, delete another paragraph, and change a table row
- [ ] `node <mdc> skill install` — Codex reads `~/.agents/skills/markdown-diff-review/SKILL.md`. Check that the skill shows once in Codex (not twice)
- [ ] Open the scratch repository in the Codex app and start a new task. Record the app version and the sandbox mode (default `workspace-write`)

## Sandbox

- [ ] Ask: "Review my doc changes visually." Record whether Codex asks to run `MDC review` outside the sandbox, and what happens if you decline (expected: the command says it cannot write its state folder or listen, and stops)
- [ ] With approval, `review` prints a one-time `localhost` link

## Annotations

- [ ] Open the link in the in-app browser. In the console of the in-app browser (if available) or by trying the annotation tool, record whether `document.oai` exists on this page
- [ ] Use the annotation tool on the changed paragraph. Record the message Codex receives: does it include the metadata (`path`, `side`, `start`, `end`, `kind`, `rev`)?
- [ ] Annotate the deleted paragraph (red). The metadata says `side: "old"`. Codex runs `MDC show --rev <rev> --side old <path> <start>-<end>` and does not edit those line numbers in the working tree
- [ ] Annotate a row in the merged table. The metadata names the right lines
- [ ] Codex runs `MDC mark --rev <rev>` before editing, then edits only the reviewed file
- [ ] `MDC review --since-last` shows only Codex's edits
- [ ] Replace `localhost` with `127.0.0.1` in the address (same port, a new link from `MDC review --reopen`). Record whether the annotation tool still works

## Page comments path

- [ ] Add one block comment in the page and press **Send to agent**. Say "done". Codex runs `MDC comments` and addresses it

## Pull request mode (1.7.0+)

Needs the GitHub CLI signed in. Pull request mode uses the network and writes refs to `.git`, so every `MDC` command needs approval to run outside the sandbox (record whether Codex asked). Use the public test repository's pull request #8 (drum-grammer/markdown-diff-cat-testbed) after checking that you have no pending review there.

- [ ] Ask Codex to review pull request 8 visually. It runs `MDC review --pr 8` (record the approval prompt) and opens the link in the in-app browser
- [ ] Existing threads sit under their blocks; the header shows **Redraw** and **Add to pending review**
- [ ] Point at a block with a Codex annotation: the metadata carries the path, side and lines (as in worktree mode)
- [ ] Add a comment in the page, press **Add to pending review** and **Add** yourself — Codex must not press them. Check the pending review on github.com, then delete it there
- [ ] `MDC stop --clean`

## Results

| Item | Result | Notes |
|---|---|---|
| ChatGPT / Codex app version | | |
| macOS version | | |
| Node version | | |
| markdown-diff-cat version and commit | | |
| Sandbox: approval asked for `review` / `comments` / `mark` | | |
| Declined approval: clear message | | |
| `document.oai` on the page (strict CSP) | | |
| Annotation carries the metadata | | |
| Old-side annotation → `show --side old`, no edit by old lines | | |
| Merged table row annotation | | |
| `mark --rev` then edit | | |
| `--since-last` | | |
| `127.0.0.1` instead of `localhost` | | |
| Page comments → `comments` | | |
| Skill shows once | | |
| PR mode: approval prompts (network, `.git` refs) | | |
| PR mode: threads, annotation metadata | | |
| PR mode: pending review on GitHub (then deleted); Codex did not press Add | | |

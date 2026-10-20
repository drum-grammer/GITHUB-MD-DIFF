# Claude Code desktop — manual checklist (markdown-diff-cat, worktree mode)

Run this on macOS with the Claude Code desktop app before the worktree-mode pull request is merged. Fill in the results table at the end and paste it into the pull request. Codex has its own checklist: [codex-checklist.md](codex-checklist.md).

## Setup

- [ ] Build: `pnpm --filter markdown-diff-cat build`. Note the absolute path of `packages/review/dist/markdown-diff-cat.mjs` (below: `<mdc>`)
- [ ] Make a scratch repository with one committed Markdown file, then change a paragraph and a table row in it
- [ ] `node <mdc> skill install` — `~/.agents/skills/markdown-diff-review/SKILL.md` exists, and `~/.claude/skills/markdown-diff-review` is a symlink to it
- [ ] `node <mdc> skill install --check` prints `same` twice
- [ ] Open the scratch repository in Claude Code desktop and start a new session

## Review loop

- [ ] Ask: "Review my doc changes visually." Claude runs `MDC review` with Bash `run_in_background` (record the exact command it used)
- [ ] Claude opens the printed link in the Browser pane. Record whether a domain permission prompt appeared and in which permission mode
- [ ] The page shows the changed file: unchanged sections folded, one merged table showing only the changed row, `]` and `[` move between changes
- [ ] Claude runs `MDC wait` in the background
- [ ] Add three comments: one block, one dragged range, one with the suggestion button. Press **Send to agent**
- [ ] The `wait` notification arrives and Claude reads the handoff. It edits only the files listed in the header and replies per comment number
- [ ] Claude offers `MDC review --since-last`. After it runs, the open page shows "The review base changed", and the new link shows only Claude's edits
- [ ] Reload the Browser pane: the page still works (the session survives a reload)
- [ ] `MDC stop`: the server exits, and `server.json` is gone from the state folder

## Element selection (unknown in the design)

- [ ] In the Browser pane, press Cmd+Shift+S and pick a paragraph in the rendered diff. Record exactly what Claude receives (text, selector, any `data-mdc-new` / `data-mdc-old` attribute, screenshot)

## No browser panel

- [ ] In a Claude Code CLI session (terminal), `MDC review --open` opens the system browser and the loop above still works with `MDC comments`

## Results

| Item | Result | Notes |
|---|---|---|
| Claude Code desktop version | | |
| macOS version | | |
| Node version | | |
| markdown-diff-cat version and commit | | |
| `review` in background | | |
| Browser pane opens the link (permission prompt?) | | |
| Folding, merged table, `]` `[` | | |
| `wait` notification and handoff | | |
| Edits only listed files, replies per comment | | |
| `--since-last` shows only the agent's edits | | |
| Reload keeps the session | | |
| `stop` | | |
| Cmd+Shift+S element selection — what Claude receives | | |
| CLI `--open` fallback | | |

# Known differences from GitHub rich diff

Recorded from the first parity report (`pnpm parity`, fixtures captured from drum-grammer/markdown-diff-cat-testbed). Each line: scenario · what differs · why the engine keeps its behavior.

| Scenario | Difference | Why kept |
|---|---|---|
| html | `<details>` whose Markdown body is split by blank lines renders open (three blocks) | Each HTML block is sanitized on its own so an unbalanced tag cannot close engine wrappers |
| (all) | No syntax highlighting inside code blocks | Out of scope for M1; code blocks are compared as whole blocks |
| (all) | Lists merged or split by removing a block in between are shown unchanged apart from the removed block | Whole-HTML comparison is done only for one-to-one block pairs |
| footnotes | GitHub shows the old and the new footnote sections one after the other, both marked unchanged; the engine shows one section and marks an edited footnote as removed + added | A review tool must not hide a changed footnote; footnotes are paired by label |
| tasklist, followup-docs-roadmap | When a few words are appended to a short list item, GitHub shows the old item removed and the new item added; the engine shows a word diff | The engine shows a whole block only when more than 45% of the words changed (threshold set from the parity word table at the end of M1); GitHub's choice does not follow the ratio alone |
| images | A paragraph that is only an image whose alt text changed: GitHub keeps one changed paragraph with the old and new image inline; the engine shows the old and the new paragraph | Every unit of that paragraph changed, so it is above the whole-block threshold; the visible change is the same |
| math | GitHub renders math in the browser from the TeX source (`math-renderer`); the engine renders KaTeX HTML on the server, so the normalized text differs. GitHub shows changed display math inline; the engine shows the old and the new block | Server-side KaTeX keeps the page free of remote scripts; math blocks are compared as whole blocks |
| tables | Two changed tables in a row: GitHub lists both old tables first, then both new tables; the engine keeps each old/new pair together | The extension merges a table pair only when the old table is directly followed by the new one |

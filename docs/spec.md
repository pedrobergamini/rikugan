# Rikugan (Browser-First) — Product & Engineering Spec

> **One-line:** Rikugan is a local-first code review tool that takes a **local git diff**, reorganizes it into an easy-to-understand **review story**, and serves a **beautiful browser UI** (hoverable inline notes, grouped changes, bug/flag sidebar) — powered **only** by `codex exec` (schema-driven).

---

## 0) Why browser-first (and whether a TUI is feasible)

A TUI can absolutely render grouped diffs, findings, and navigation. But the **exact UX you described** — especially **hover tooltips**, rich inline annotations, smooth scrolling with “cards”, and PR-like diff affordances — is **significantly more natural in a browser**.

A TUI can approximate “hover” via focus/selection + a side panel, but it won’t feel like Devin Review’s “hover over a line and see contextual AI notes” experience. So for v1, Rikugan should be **browser-only** and treat any terminal UI as optional future work.

---

## 1) Product principles

1. **Local-first:** Works on a local repo + local diff. No PR required.
2. **Browser UX is the product:** Rikugan is judged by the quality of the **review-reading experience**.
3. **High signal, low noise:** Findings are sparse, categorized, and evidence-based.
4. **Codex-only:** All AI work is done via **`codex exec`** (non-interactive).
5. **Structured outputs:** AI responses must be **JSON schema validated**, always.
6. **Fast iteration loop:** Generate → open UI → scan groups → drill into notes → ask questions.

---

## 2) Feature parity target (Devin Review-inspired UX)

Rikugan targets the same experience patterns Devin Review advertises publicly:

- **Smart diff organization:** group edits logically (not file alphabetical order) and present hunks in an easy review order.
- **Copy/move detection:** show moved/renamed code cleanly, not as delete+insert noise.
- **Bug catcher:** generate a list of issues and label them by severity / confidence.
- **Codebase-aware chat:** ask questions about the diff with relevant context from the repo, and ask from any comment/flag/bug inline.

Reference (inspiration): Devin Review docs + Cognition blog post.  
- https://docs.devin.ai/work-with-devin/devin-review  
- https://cognition.ai/blog/devin-review

---

## 3) CLI UX (browser-first)

Binary name: **`rikugan`**

### 3.1 Primary commands

#### `rikugan review`
Generates a new review run and opens the browser UI.

```bash
rikugan review [diff-source] [options]
```

Behavior:
1. Capture diff from the local repo (or diff file/stdin).
2. Create a new `runId` and persist the run bundle to disk.
3. If `--format ui` (default): start a local web server.
4. If `--format ui`: open the browser to `http://127.0.0.1:<port>/run/<runId>` (unless `--no-open`).
5. If `--format json|md|html`: do not start the server; print the formatted review to stdout.
6. Stream progress in the UI while Codex runs (nice-to-have, but spec’d).

#### `rikugan list`
Lists previous runs for the current repo (newest first).

```bash
rikugan list [--limit 20] [--json]
```

Output includes: runId, date, branch, base/head, diff source, files changed, findings count.

#### `rikugan open`
Opens an existing run in the browser UI (and starts the local server if needed).

```bash
rikugan open <runId>
rikugan open --latest
```

#### `rikugan serve`
Starts the local UI server without generating a new run (home page lists runs).

```bash
rikugan serve [--port 4823] [--host 127.0.0.1]
```

### 3.2 Utility commands

- `rikugan export <runId> --format html|md|json --out <dir>`
- `rikugan doctor` (verifies git + codex binary + optional `rg`)
- `rikugan config` (prints effective config + locations)
- `rikugan cache clear`

---

## 4) Diff sources (local git)

Rikugan must accept these diff sources:

### Convenience selectors
- `--staged` → `git diff --cached -M -C`
- `--uncommitted` → `git diff -M -C`
- `--range <A..B>` → `git diff A..B -M -C`
- `--commit <sha>` → `git show <sha>`
- `--since <ref>` → `git diff <ref>..HEAD -M -C`
- `--paths <glob...>` → pass pathspecs to git diff

### Raw diff
- `--diff-file <path>` (unified diff text)
- `--diff-stdin` (read unified diff from stdin)

Default: if no diff source given → `--uncommitted`, warn if clean.

**Move/copy detection:** for git-generated diffs, always include `-M -C` to surface rename/copy info (this supports the “copy/move detection” UX).

---

## 5) Run persistence (“past review” UX)

### 5.1 Run storage layout
Store per-repo runs under:

```
<repo>/.rikugan/
  runs/
    <runId>/
      meta.json
      diff.patch
      review.json
      state.json         # dismissals/resolutions, UI prefs
      codex/
        grouping.prompt.txt
        grouping.schema.json
        grouping.output.json
        findings.prompt.txt
        findings.schema.json
        findings.output.json
        ...
      chat/
        thread.jsonl      # optional
```

### 5.2 Run ID
Use ULID (sortable, unique) or `YYYYMMDD-HHMMSS_<shortsha>`. Requirement: sortable by time.

### 5.3 What `rikugan list` shows
For each run:
- runId
- createdAt
- branch + headSha
- diff source (staged/uncommitted/range/etc.)
- stats: files, insertions, deletions
- #groups
- #bugs / #flags

### 5.4 “Open a past run” behavior
`rikugan open <runId>`:
- starts server if not running
- opens browser to `/run/<runId>`
- UI loads `review.json` + `diff.patch` from disk via the server API

---

## 6) Browser UI spec (the core product)

### 6.1 Layout (Devin-style)
A 3-pane layout with a sticky top bar:

**Top bar**
- Repo name + branch + runId
- “Unified | Split” toggle
- “Collapse context” toggle
- Search box
- Export button

**Left: Story outline**
- Groups in suggested review order
- Badges: `Bugs`, `Flags`, `Files`, `Risk`
- Scrollspy highlights current group as you scroll

**Center: Diff reading column**
- Scrollable “review story”
- Each group is a card with:
  - Title
  - 1–3 sentence rationale (what/why)
  - Risk notes + suggested tests
  - Ordered hunks/files
- Each file/hunk is collapsible

**Right: Analysis sidebar**
- Tabs: `Bugs | Flags | All`
- Filters by severity/confidence
- Clicking a finding jumps to evidence in the diff and highlights lines

### 6.2 Hover UX (must-have)
Rikugan must support **hoverable inline AI notes**:

- AI creates **Annotations** anchored to diff lines or hunks.
- In the diff gutter, show a small icon/badge on annotated lines.
- Hover displays a tooltip/popover with:
  - short title
  - explanation in markdown
  - evidence snippet
  - “Ask about this” button (opens chat pre-scoped)

Also support “hunk-level explainers”:
- Above each hunk, show a compact explanation with a “more” expander.

### 6.3 Asking questions (chat)
- Chat panel opens from:
  - top bar (“Ask Rikugan”)
  - inline annotation (“Ask about this”)
  - finding (“Ask why this matters”)
- Default scope: current group; can broaden to repo.

Chat answers must:
- cite evidence (file + line range or hunk id)
- avoid hallucinated APIs; if uncertain, say so.

---

## 7) Diff rendering (use an open-source diff component)

### Recommended: `react-diff-view` (primary)
Use `react-diff-view` as the diff renderer because it:
- supports **split & unified** views
- supports **custom widgets** around change blocks (good for inline notes)
- includes a widget architecture supporting code commenting requirements
- has tokenization/highlight capabilities and web-worker support for performance

Reference:
- https://github.com/otakustay/react-diff-view

### Alternative: `diff2html` (fallback)
If you prefer generating HTML from diffs:
- supports git/unified diffs
- side-by-side and line-by-line
- GitHub-like style + syntax highlighting + similarity matching

Reference:
- https://github.com/rtfpessoa/diff2html

**Spec requirement:** whichever library is chosen must support:
- unified + split views
- stable line mapping (old/new line numbers)
- a way to attach inline widgets or overlays for annotations

---

## 8) Core pipeline

### 8.1 Stages
1. **Collect**
   - repo root, HEAD, branch, dirty state
   - diff content + changed files list

2. **Parse + normalize**
   - parse into files + hunks
   - compute line maps (old/new numbering)
   - attach lightweight symbol hints (regex / optional tree-sitter)

3. **Segment into ChangeUnits**
   - ChangeUnit ≈ a small cluster of hunks in the same file/symbol
   - add heuristic tags: `tests`, `docs`, `config`, `api`, `refactor`, etc.

4. **Group + order**
   - heuristic grouping first
   - Codex refines:
     - merge/split groups
     - choose titles
     - set review order

5. **Generate UI-ready review artifacts**
   - group summaries (what/why)
   - hunk explainers (short)
   - annotations (line/hunk anchored tooltips)
   - findings (bugs/flags with evidence)

6. **Serve**
   - local server serves UI + run data
   - UI renders groups and annotations

---

## 9) Codex integration (only `codex exec`)

Rikugan must call **`codex exec`** in non-interactive mode.

### 9.1 Required behaviors
- Always run with **read-only sandbox** (`--sandbox read-only`).
- Always request schema-constrained outputs (`--output-schema <schema.json>`).
- Always write final message to a file (`--output-last-message <path>`), then parse JSON.

Codex references:
- Non-interactive mode: https://developers.openai.com/codex/noninteractive/
- CLI reference: https://developers.openai.com/codex/cli/reference/

### 9.2 Pass-through flags
Expose these CLI flags and pass to Codex:
- `--model <string>` → `codex exec --model <string>`
- `--profile <name>` → `codex exec --profile <name>`
- `--oss` → `codex exec --oss` (for local open source provider; requires running Ollama)
- `--cd <path>` → sets workspace root for Codex if needed

### 9.3 Structured outputs only (no freeform)
All Codex prompts must end with:
- “Return JSON matching this schema. No extra keys. No prose.”

If schema validation fails:
- retry once with a repair prompt that includes the invalid JSON + schema
- else fallback to heuristic-only grouping and a “no findings generated” banner

### 9.4 Sessions for chat (optional)
Codex supports resuming exec sessions:
- `codex exec resume [SESSION_ID]` or `--last` to resume the most recent session

If feasible, store the session id in `meta.json` to preserve a single consistent context for chat.

---

## 10) Review JSON schema (UI-first)

Rikugan’s UI should render purely from `review.json` + `diff.patch`.

### 10.1 Top-level contract
```json
{
  "version": "1.0",
  "runId": "01J...",
  "createdAt": "2026-01-24T00:00:00.000Z",
  "repo": {
    "root": "/abs/path",
    "headSha": "abc123",
    "branch": "feature/x",
    "dirty": true
  },
  "diffSource": { "kind": "staged", "spec": "--staged" },
  "stats": { "filesChanged": 0, "insertions": 0, "deletions": 0 },
  "diff": { "files": [] },
  "groups": [],
  "annotations": [],
  "findings": []
}
```

### 10.2 Annotations (hover notes)
```ts
export interface Annotation {
  id: string;
  kind: "explain" | "risk" | "question" | "test" | "nit";
  confidence: number;      // 0..1
  title: string;
  bodyMarkdown: string;

  anchor: {
    filePath: string;
    side: "old" | "new";
    line: number;          // line number on that side
    hunkId?: string;
  };

  actions?: Array<{
    label: string;         // e.g. "Ask about this"
    action: "openChat";
    scope: "group" | "file" | "repo";
  }>;
}
```

### 10.3 Findings (bug catcher)
Two categories aligned to Devin’s docs: Bugs vs Flags, with severity and confidence.

```ts
export interface Finding {
  id: string;
  kind: "bug" | "flag";
  severity?: "severe" | "normal";          // bugs
  flagClass?: "investigate" | "informational"; // flags
  confidence: number;
  title: string;
  detailMarkdown: string;
  evidence: Array<{
    filePath: string;
    side?: "old" | "new";
    lineRange?: [number, number];
    hunkId?: string;
    excerpt?: string;
  }>;
  status: "open" | "resolved" | "dismissed";
}
```

---

## 11) Local web server

### 11.1 Server requirements
- Bind to `127.0.0.1` by default.
- Choose a free port by default; allow `--port`.
- Serve:
  - UI static assets
  - API endpoints to read run bundles

### 11.2 API endpoints (minimum)
- `GET /api/runs` → list runs
- `GET /api/run/:runId` → return `review.json`
- `GET /api/run/:runId/diff` → return `diff.patch`
- `POST /api/run/:runId/chat` → chat (optional)
- `GET /api/run/:runId/events` → SSE progress stream (optional, for live generation)

---

## 12) Testing, screenshots, and visual QA

### 12.1 Tests
- Unit:
  - diff parsing
  - line mapping
  - change unit segmentation
  - schema validation and repair path
- Integration:
  - mock `codex` binary that returns deterministic JSON
  - end-to-end: generate run → server loads → UI renders
- UI:
  - Playwright smoke tests for `/run/<id>`
  - Screenshot tests for key states

### 12.2 Required screenshots
Store under `./artifacts/screenshots/`:
- `overview.png` (groups list + first group expanded)
- `hover-annotation.png` (tooltip visible)
- `findings-sidebar.png`
- `split-view.png` and `unified-view.png`
- `mobile.png` (375px width)

---

## 13) Implementation stack (recommended)

- Node 20+ + TypeScript
- CLI: `commander` (or `oclif`)
- Server: `express` or `fastify`
- UI: React + Vite
- Styling: Tailwind (or CSS Modules)
- Diff rendering: `react-diff-view` (preferred) or `diff2html` (fallback)
- Search for context: `ripgrep` (`rg`) optional
- Schemas: `zod` + JSON Schema files for Codex `--output-schema`

---

## 14) Acceptance checklist (v1)

- [ ] `npm i -g rikugan` installs and `rikugan doctor` works
- [ ] `rikugan review --staged` opens browser UI and shows grouped review story
- [ ] Hover tooltips work on annotated diff lines
- [ ] Unified/split diff toggle works
- [ ] `rikugan list` shows runs and `rikugan open --latest` works
- [ ] Findings categorized into Bugs/Flags with severity/confidence and jump-to-evidence
- [ ] Rikugan never calls an AI API directly; only shells out to `codex exec`

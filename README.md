# Rikugan

Rikugan is a local-first code review tool that turns a local git diff into a browser-first review story
with grouped changes, hoverable inline notes, and a findings sidebar. It uses `codex exec` in
non-interactive mode with schema-validated JSON outputs.

## Quick start

```bash
# build
pnpm -C packages/rikugan build

# run a review from a diff file
rikugan review --diff-file packages/rikugan/fixtures/sample.diff
```

## Features

- Browser-first review UX (grouped story + findings + inline annotations)
- Unified / split diff toggle
- Hover tooltips for annotations
- Findings sidebar with jump-to-evidence
- Local run persistence under `.rikugan/runs/<runId>/`
- `codex exec` only (read-only sandbox, schema-validated outputs)

## Commands

- `rikugan review`
- `rikugan list`
- `rikugan open`
- `rikugan serve`
- `rikugan export`
- `rikugan doctor`
- `rikugan config`
- `rikugan cache clear`

## Development

```bash
pnpm install
pnpm -C packages/rikugan test
```

## License

MIT

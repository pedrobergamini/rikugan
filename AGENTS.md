# Repository Guidelines

## Project Structure & Module Organization
- `packages/rikugan/src/`: TypeScript source for the CLI, server, diff parsing, and run management.
- `packages/rikugan/ui/src/`: React UI for the browser review experience (built with Vite).
- `packages/rikugan/tests/`: Vitest tests (`**/*.test.ts`) and shared fixtures; UI tests live in `tests/ui/`.
- `packages/rikugan/schemas/`: JSON schemas used to validate Codex outputs.
- `packages/rikugan/fixtures/`: Sample diffs and test data.
- `packages/rikugan/artifacts/`: UI screenshots and export artifacts used in docs/README.
- `docs/`: Specs and design notes.
- `skills/`: Codex skill bundles for Rikugan.

## Build, Test, and Development Commands
- `pnpm install`: Install workspace dependencies.
- `pnpm build`: Build the CLI and UI (delegates to `packages/rikugan`).
- `pnpm lint`: Run ESLint with zero warnings.
- `pnpm format`: Format with Prettier.
- `pnpm typecheck`: TypeScript `tsc --noEmit`.
- `pnpm test`: Build, then run Vitest + Playwright.
- `pnpm -C packages/rikugan dev:ui`: Run the UI dev server.

## Publishing (npm)
1. Bump version in `packages/rikugan/package.json` (SemVer).
2. `pnpm -C packages/rikugan build`
3. Run `npm publish` from `packages/rikugan` (not the workspace root).

## Coding Style & Naming Conventions
- TypeScript + ESM; React for UI.
- Prettier enforces double quotes, semicolons, no trailing commas, and `printWidth: 100`.
- ESLint is configured for TS/React and should be clean (`--max-warnings=0`).
- Naming: `camelCase` for vars/functions, `PascalCase` for types/components. Prefer kebab-case for non-`index` filenames (e.g., `diff-parse.test.ts`).

## Testing Guidelines
- Unit/logic tests use Vitest and live under `packages/rikugan/tests/**/*.test.ts`.
- UI/e2e tests use Playwright in `packages/rikugan/tests/ui/`.
- Run subsets with `pnpm -C packages/rikugan test:unit` or `pnpm -C packages/rikugan test:ui`.

## Commit & Pull Request Guidelines
- Commit messages follow Conventional Commits without scopes (e.g., `feat: add export flow`, `fix: handle empty diff`).
- PRs should include: a short summary, tests run, linked issues (if any), and screenshots/GIFs for UI changes.

## Generated Outputs & Local Data
- Build/test outputs like `packages/rikugan/dist`, `packages/rikugan/ui/dist`, and `packages/rikugan/test-results` are generated. Don’t hand-edit them; regenerate via the scripts above.

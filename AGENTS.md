# AI Agent Instructions for aislop

This file provides context for AI coding assistants (Claude Code, OpenCode, Copilot, Cursor, etc.) working on the aislop codebase.

## What is aislop?

aislop is a unified code-quality CLI that catches the lazy patterns AI coding tools leave behind. It runs formatting, linting, code-quality, AI-pattern, architecture, and security checks behind a single command and returns a score out of 100.

- **npm package**: `aislop`
- **CLI binary**: `aislop`
- **Config directory**: `.aislop/`
- **Repository**: https://github.com/heavykenny/aislop

## Build & test commands

```bash
pnpm install           # Install dependencies
pnpm build             # Build with tsdown (rm -rf dist first)
pnpm typecheck         # tsc --noEmit
pnpm test              # Build + vitest run
pnpm vitest run        # Run tests without rebuilding (faster iteration)
pnpm scan              # Build + run aislop on itself
node dist/cli.js scan . # Run after building manually
```

## Key architecture decisions

- **TypeScript strict mode**, ES2022 target, bundler module resolution
- **Zod v4** for config validation — import from `"zod/v4"`, not `"zod"`
- **tsdown** (rolldown-based) for bundling — two entry points: `cli.ts` and `index.ts`
- **Version injection**: `tsdown.config.ts` reads `package.json` version and injects it via `env.VERSION`. Access it in source via `process.env.VERSION`.
- **vitest** for testing with a 30-second timeout
- **pnpm** as the package manager (pnpm-workspace.yaml, pnpm-lock.yaml)
- **Node >= 20 required** — `tsdown`/`rolldown` uses `node:util.styleText` which requires Node 20.12+

## Project structure

```
src/
  cli.ts                    # CLI entry (commander.js)
  index.ts                  # Public API exports
  version.ts                # APP_VERSION constant

  commands/                 # CLI subcommands
    scan.ts, fix.ts, ci.ts, init.ts, doctor.ts, rules.ts, interactive.ts

  config/                   # Configuration
    schema.ts               # Zod v4 schema
    defaults.ts             # Default values and YAML templates
    index.ts                # File discovery and loading

  engines/                  # Detection engines (run in parallel)
    types.ts                # Diagnostic, Engine, EngineContext types
    orchestrator.ts         # Parallel engine runner
    format/                 # Formatting (biome, ruff, gofmt, cargo fmt, rubocop, php-cs-fixer)
    lint/                   # Linting (oxlint, ruff, golangci-lint, clippy, rubocop)
    code-quality/           # Complexity, duplication, dead code (knip)
    ai-slop/                # AI pattern detection (13 rules)
    architecture/           # Custom import/path rules
    security/               # Secrets, eval, innerHTML, SQL/shell injection, audits

  scoring/                  # Score calculation (0-100, density-aware)
  output/                   # Terminal rendering, JSON output
  utils/                    # Discovery, git, subprocess, tooling, telemetry

tests/                      # Vitest tests (13 files, 285+ tests)
scripts/                    # Postinstall tool downloads (ruff, golangci-lint)
.aislop/                    # aislop's own config
```

## Self-detection avoidance

aislop scans itself. Detector source code must NOT contain the literal patterns being detected. Use string concatenation to break patterns:

```typescript
// WRONG — aislop will flag its own source
const pattern = /as any/;

// CORRECT — breaks the literal so it won't self-match
const pattern = new RegExp(`${"a" + "s"}\\s+${"an" + "y"}`);
```

This applies to regex patterns, string literals, and diagnostic messages in all detector files under `src/engines/ai-slop/`.

## Naming conventions

- **`aislop`** — the npm package name, CLI binary name, and config directory (`.aislop/`)
- **`ai-slop`** — the engine name and rule prefix (e.g., `ai-slop/trivial-comment`). Do NOT rename these — they are internal identifiers, not user-facing branding.
- **`"AI Slop"`** — the category label in diagnostics. Do NOT change this.

## Workflow

- **Branch model**: `develop` branch -> PR to `main` -> squash merge
- **Releases**: automated via `.github/workflows/release.yml` on `v*` tags
- **CI**: Node 20 + 22 matrix, typecheck + build + test + self-scan
- All changes should pass: `pnpm typecheck && pnpm test && pnpm scan`

## Adding new AI slop rules

1. Pick the right file in `src/engines/ai-slop/` (or create a new one)
2. Write a detector function returning `Diagnostic[]`
3. Use string concatenation to avoid self-detection (see above)
4. Register the rule in `src/commands/rules.ts` (`BUILTIN_RULES` array)
5. Write tests in `tests/`
6. Validate: `pnpm typecheck && pnpm vitest run && pnpm scan`

## Important constraints

- `complexity.ts` must stay <= 400 lines (it checks itself for file-too-large)
- The `files` field in `package.json` controls what ships to npm — only `dist` and `scripts`
- PostHog telemetry key is a public client-side key (safe to hardcode)
- Telemetry is opt-out and off in CI by default

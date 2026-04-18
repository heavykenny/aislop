# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.5.0 (2026-04-16)

Two big threads landed together:

1. **Full CLI UX rehaul.** Every command rewritten around a new `src/ui/` module with a clack-style visual language. live concurrent engine grid for `scan`, live rail flows for `fix` / `init` / `doctor`, `wcwidth`-aware alignment, accent-green arrows on every hint line, and a proper non-TTY contract for CI.
2. **In-house unused-declaration removal engine.** aislop now owns the most destructive category of auto-fixes (removing unused functions, variables, classes, types, interfaces, enums) instead of delegating to `oxlint --fix` or `knip --fix`: Those tools kept corrupting user code by deleting declaration signatures and leaving orphan bodies. The new engine uses the TypeScript compiler API, runs a parse-check before writing, and reverts any removal that would break file syntax.

### New
- `src/ui/` module: `theme`, `symbols`, `width`, `logger`, `header`, `summary`, `error`, `rail`, `live-rail`, `live-grid`, `prompts`, `invocation`
- `src/engines/code-quality/unused-removal.ts`: in-house engine for safely removing unused top-level declarations (const / let / var / function / class / type alias / interface / enum) with side-effect guard and parse-check-before-write safety
- Live animated spinner (braille frames) on each rail step while it runs
- `Verifying results…` live step during the post-fix verification scan
- Invocation-aware hints: all printed commands render as `npx aislop …` so copy-paste works regardless of install method (global, devDep, fresh npx)
- `--human` flag on `aislop ci` to re-enable the full human design in CI output
- JSON output gains `schemaVersion: "1"` and `cliVersion` at the top of the envelope
- Biome lint rule blocks `picocolors` imports outside `src/ui/`
- `renderHintLine` helper: single source of truth for the accent-green `→` arrow + hint text pattern used across `scan` / `fix` / `doctor` / `init` / `rules` / `--help`
- Top-level `--help` and every subcommand `--help` now show the brand header (`aislop 0.5.0 · the quality gate for agentic coding`) via commander's `beforeAll` hook
- `RailStep` gained a `"warn"` status (yellow `!`) so steps that complete with unresolved items don't misleadingly show `◆` (done)

### Changed
- Scan shows all six engines updating concurrently in a live grid with aligned columns (label 18, status 12, elapsed 6) and wcwidth-aware padding
- Fix renders live. Each step appears as `◇ Step…` with a spinner while running, then resolves to `◆ / ! / ✗ Step. <result>` and emits a `│` connector to the next step
- Fix footer is now `└  Done · N fixed · M remain`, always with a preceding `│`
- Summary counters are color-coded: `N errors` red, `N warnings` yellow, `N fixable` green
- Fix command hint expanded from `fix --agent` to `fix --claude (or --codex, --cursor, --gemini, etc.) to hand off to agent`. Lists common agents inline, mentions `-f` when aggressive fixes apply
- Fix pipeline reordered: unused declarations run **before** lint fixes, so oxlint's safer `--fix` mode sees clean state and no longer touches declarations at all
- Doctor is project-aware: sub-header shows project + primary language, one row per engine with its backing tool, `✗` + inline remediation for missing tools, `─` + "no X in project" for skipped engines, footer shows `Ready · N engines · M missing`
- Rules grouped by engine with aligned severity + fixable columns, plus scan/init next-step hints
- Init is a clack wizard (≤4 prompts), writes `.aislop/config.yml` preserving the existing schema, success rail + `→ Try npx aislop scan` hint
- Interactive menu uses `@clack/prompts`; "Next?" prompt re-uses the full menu so users can pick scan/fix/init/etc. directly instead of going back to a generic menu line
- Init / doctor / fix accept `printHeader: false` when dispatched from the interactive menu, so the brand line doesn't print twice
- SQL-injection detection tightened: requires a DB-like receiver (`db.`, `knex.`, `prisma.`, `pool.`, `sequelize.`, `pg.`, etc.) before flagging template literals. `log.raw(\`…\${x}\`)` and similar no longer false-positive
- `no-control-regex` oxlint rule disabled (ANSI-stripping regexes are a legitimate CLI pattern)
- Vulnerable-dependency diagnostic help lines now read `Run \`npx aislop fix -f\` to apply this fix. Upgrade to version X or later`, directing users to the aggressive-fix path
- Format engine filters out files that no longer exist on disk before calling the formatter, so stale git-status paths from removed files don't produce "No such file or directory" warnings
- `knip --fix` usage scoped to value-export keyword stripping only; type and declaration removal delegated to the new in-house engine

### Fixed
- `oxlint --fix` no longer damages arrow-function declarations by deleting the signature while leaving the body (this was the long-standing class of "file corrupted after `aislop fix`" bug). The engine's `fix` mode turns `no-unused-vars` off entirely; detection still runs with the rule on so warnings surface, and the new unused-removal engine handles them safely
- aislop's own `applyUnusedVarPrefixFixes` had a destructive branch that deleted unused `const` declarations under certain shapes; now only ever prefixes with `_`
- `fix`-then-`scan` is a stable fixed point. Running `fix` a second time produces zero further changes
- Knip's silent `--fix-type=exports,types,duplicates` flag-comma bug worked around by repeating the flag per type
- Doctor no longer emits a useless `4 of 4 tools available` footer listing bundled tools that are always present. It now shows one row per engine with its actual tool and only flags what's missing for languages present in the project

### Removed
- Hand-rolled keypress menu (replaced by clack)
- `src/output/{layout,pager,scan-progress,fix-progress}.ts`
- `src/utils/{highlighter,logger,spinner}.ts`
- `fixKnipUnusedExports` / `runKnipUnusedExports` (consolidated into the unused-removal engine)

### Dependencies
- Added: `@clack/prompts`, `wcwidth`, `@types/wcwidth`
- `typescript` moved from `devDependencies` to `dependencies`. Required at runtime by the unused-removal engine (`ts.createSourceFile`)

### Breaking
- None at the CLI contract level. All flags, exit codes, and JSON field names remain stable.



## [0.2.0] - 2026-03-12

### Added

- **Unused dependency detection**: 5 new rules powered by knip:
  - `knip/dependencies`: unused packages in package.json
  - `knip/devDependencies`: unused devDependencies in package.json
  - `knip/unlisted`: packages imported but missing from package.json
  - `knip/unresolved`: imports that cannot be resolved
  - `knip/binaries`: binaries used but not declared
- **`aislop fix` removes unused dependencies**: detects and removes unused deps/devDeps from package.json automatically
- **GitHub Packages publishing**: each release now also publishes `@heavykenny/aislop` to npm.pkg.github.com
- **Documentation site**: detailed docs moved to `docs/` directory (installation, commands, rules, configuration, scoring, CI/CD, telemetry)
- **Example configs**: `examples/` directory with 4 preset configurations (typescript-strict, monorepo-relaxed, python-go, architecture-rules)
- **Project infrastructure**: `.editorconfig`, `.nvmrc`, `.gitattributes`, `biome.json`, `AGENTS.md`, `knip.json`
- **Acknowledgments**: README now credits the open-source projects aislop is built on
- npm downloads badge in README

### Changed

- README slimmed from 374 to ~185 lines. Reference material moved to docs/
- README restructured: Installation → Usage → Use in project → Why → What it catches
- CONTRIBUTING.md updated to target `develop` branch with AGENTS.md reference
- Expo/React Native documented in supported languages and linting tables
- 288 total tests across 14 test files

## [0.1.3] - 2026-03-12

### Fixed

- Scoring penalties are now proportional to codebase size. A single issue in a 200-file project no longer tanks the score the same as in a 2-file project (fixes #9)
- Add `smoothing` to scoring config schema (was missing, causing TypeScript error)
- Fix `calculateScore` call in scan.ts to pass `sourceFileCount` and `smoothing` as separate arguments (smoothing was previously passed in the sourceFileCount position)
- Compact `countParams` to keep `complexity.ts` under the 400-line limit after biome formatting

### Added

- 52 comprehensive scoring tests covering severity ordering, engine weights, edge cases, and density-aware scoring
- Configurable `scoring.smoothing` option (default: 10) for issue-density normalization
- 285 total tests across 13 test files

## [0.1.2] - 2026-03-11

### Fixed

- False positive: `template.innerHTML` no longer flagged as XSS. `<template>` elements are inert by spec and don't execute scripts (fixes #7)
- `aislop scan` now exits with code 1 when error-severity diagnostics are found, fixing CI pipelines that depend on the exit code (fixes #8)
- Self-detection of `innerHTML` pattern in `risky.ts` via string concatenation

### Added

- 3 new security tests for template innerHTML exception

## [0.1.1] - 2026-03-11

### Added

- Anonymous opt-out telemetry via PostHog for aggregate usage insights
  - Respects `AISLOP_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, and `telemetry.enabled: false` in config
  - No PII collected; fire-and-forget with no impact on scan performance
  - Disabled automatically in CI environments

### Fixed

- False-positive `function-too-long` warning on `isBlockArrow` caused by the naive brace counter miscounting `{` and `}` characters inside regex literals
- `complexity.ts` trimmed to stay within the 400-line file size limit

## [0.1.0] - 2025-07-14

### Added

- Initial release
- Six detection engines: format, lint, code-quality, ai-slop, architecture, security
- AI slop detection rules:
  - `ai-slop/trivial-comment`: comments that restate the code
  - `ai-slop/swallowed-exception`: empty catch blocks and catch-only-log
  - `ai-slop/thin-wrapper`: functions that only delegate
  - `ai-slop/generic-naming`: AI-style names like `helper_1`, `data2`
  - `ai-slop/unused-import`: unused imports in JS/TS and Python
  - `ai-slop/console-leftover`: console.log/debug/info in production code
  - `ai-slop/todo-stub`: unresolved TODO/FIXME/HACK comments
  - `ai-slop/unreachable-code`: code after return/throw
  - `ai-slop/constant-condition`: `if (true)`, `if (false)`
  - `ai-slop/empty-function`: empty function bodies
  - `ai-slop/unsafe-type-assertion`: `as any` in TypeScript
  - `ai-slop/double-type-assertion`: `as unknown as X`
  - `ai-slop/ts-directive`: `@ts-ignore` / `@ts-expect-error`
- Security rules: hardcoded secrets, eval, innerHTML, SQL injection, shell injection, dependency audit
- Code quality: function/file complexity, nesting depth, parameter count, duplication, dead code (knip)
- Formatting via Biome (JS/TS), ruff (Python), gofmt (Go), cargo fmt (Rust), rubocop (Ruby), php-cs-fixer (PHP)
- Linting via oxlint (JS/TS), ruff (Python), golangci-lint (Go), clippy (Rust), rubocop (Ruby)
- Architecture engine with custom `forbid_import`, `forbid_import_from_path`, and `require_pattern` rules
- Logarithmic scoring model (0-100) with configurable weights and thresholds
- CLI commands: scan, fix, ci, init, doctor, rules, interactive mode
- Support for `--changes` and `--staged` flags for incremental scanning
- JSON output for CI pipelines
- Auto-download of ruff and golangci-lint binaries on install
- Configuration via `.aislop/config.yml` and `.aislop/rules.yml`
- Language support: TypeScript, JavaScript, Python, Go, Rust, Ruby, PHP, Java (detection)
- Framework detection: Next.js, React, Vite, Remix, Expo, Django, Flask, FastAPI

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.6.1 (2026-04-20)

A follow-up round after 0.6.0 went live: hook UX gaps surfaced on first contact, README was still on 0.5.x, and adding deterministic duplicate-detection caught real issues in aislop's own source.

### Added

**Hook UX fixes.**
- **Per-agent `--<name>` flags on `install` / `uninstall`.** `aislop hook install --claude`, `--cursor --gemini`, `--copilot`, etc. Matches the existing `fix --claude` pattern so there's one way to select an agent across the CLI.
- **Positional agent args on `install` / `uninstall`.** `aislop hook install claude cursor` and `aislop hook uninstall gemini` now work. Previously they threw "too many arguments."
- **Interactive multi-select picker** on `aislop hook install` / `aislop hook uninstall` when no agents are specified and stdin is a TTY. Space to toggle, enter to confirm. Install defaults check the four agents that support both user and project scopes (Claude, Cursor, Gemini, Codex); uninstall only shows agents actually detected on disk. Non-TTY (CI) keeps the previous default-all behaviour.
- **Interactive-TTY guard on the internal `hook claude` / `hook cursor` / `hook gemini` subcommands.** Invoking one yourself at a terminal used to silently no-op (reading stdin from a TTY yields nothing). Now prints a hint pointing to `hook install --<agent>`.

**Three new deterministic detection rules.**
- `code-quality/repeated-chained-call` — flags 5+ consecutive method calls on the same chain that differ only in string literals. Catches the `.option("--claude", ...)` × 14 pattern.
- `code-quality/duplicate-block` — sliding 10-line window, literal-only normalisation, requires ≥7 distinct lines. Catches non-trivial copy-paste across a file.
- `ai-slop/narrative-comment` widened with a **"bare section label"** detector for 1–3-word title-case comments (`// Subcommands`, `// Init helpers`) NOT followed by a data-literal entry, so `// AWS` in a `SECRET_PATTERNS` array is correctly spared.

**Coverage widening (gaps surfaced by real-world use):**
- `ai-slop/trivial-comment` verb list gained **Write, Run, Parse, Execute, Extract, Save, Load, Build, Start, Stop, Cleanup, Setup, Configure, Validate, Process, Queue, Fire, Emit, Dispatch, Log, Print, Render** plus coverage for single-word bare imperatives (`// Cleanup`, `// Parse`). The rule now uses one consolidated verb-stem regex instead of 14 per-verb patterns.
- `ai-slop/narrative-comment` now also flags **3+ line prose blocks inside function bodies** (previously only caught at the top level before a declaration). The threshold is exempted when the prose contains WHY markers (`because`, `since`, `otherwise`, `workaround`, `note:`, `bug`, `issue`, `in prod`, `must run`, `see issue`, etc.), so genuine explanatory context still passes through.

**Suppression mechanism.** `// aislop-ignore-file <rule>` at the top of a file, or `// aislop-ignore-next-block <rule>` above a specific construct. Lets you opt out of a rule on code where the pattern is intentional (e.g. a diagnostic-push table that reads better as N similar blocks than as a data-driven loop).

### Changed

- **`README.md` covers hooks.** New "Install as a native hook" section under Usage with adapter + rules-only installer lists, quality-gate flow, and a link to [`/docs/hooks`](https://scanaislop.com/docs/hooks). Quick-start and "Why aislop" blocks mention hooks. Sample-output version banner bumped to 0.6.1.
- **Internal refactors** driven by the new rules:
  - `src/commands/doctor.ts`: extracted `systemToolDecision()` + `firstMatching()` + `FORMAT_SPECS` / `LINT_SPECS` / `AUDIT_SPECS` data tables, replacing six repeated `if (languages.includes(X)) return installedTools[Y] ? {...} : {...}` blocks.
  - `src/utils/source-masker.ts`: extracted `handleQuotesAndComments()` — the string/template/comment state machine was duplicated across the top-level and inside-interpolation branches.
  - `src/engines/ai-slop/dead-patterns.ts`: `slop()` helper replaces 8 inline `diagnostics.push({ engine: "ai-slop", category: "AI Slop", column: 0, ... })` copy-pastes.
  - `src/cli.ts`: extracted `runScan()` (shared between top-level default action and `scan` subcommand), `matchFixAgent()` + `FIX_AGENT_FLAGS` table (drives the `fix --<agent>` registration), `noFlagsPassed()` predicate.
  - Hook command wiring moved to `src/cli/hook-command.ts`, split into `registerInstall` / `registerUninstall` / `registerCallbacks` helpers.

### Notes

- **614 tests passing** (598 baseline + 16 new across `resolveAgents`, `repeated-chained-call`, `duplicate-block`, widened trivial verbs, and inside-function narrative prose).
- Self-scan: **100 / 100 Healthy**, 0 findings.
- No breaking changes. `--agent <names>` still works; it's one of four equivalent ways to select agents now.
- Packaged size: 138 kB (15 files).

## 0.6.0 (2026-04-20)

Agent integration hooks. `aislop` now plugs into Claude Code, Cursor, and Gemini CLI natively so you get machine-readable findings on the turn the agent wrote the code, not after.

### Added
- **Agent hooks for 9 agents** via `aislop hook install --agent <name>` (or `aislop hook claude`, `cursor`, `gemini` shortcuts):
  - **Runtime adapters (3)** that scan and feed findings back to the agent every edit:
    - Claude Code (`PostToolUse` on `Edit|Write|MultiEdit`)
    - Cursor (`afterFileEdit`)
    - Gemini CLI (`AfterTool`)
  - **Rules-only installers (6)** for agents without a hook lifecycle (install writes an `AISLOP.md` rules file the agent reads): Codex, Windsurf, Cline + Roo, Kilo Code, Antigravity, Copilot.
- **`aislop hook` command** with `install / uninstall / status / baseline / claude / cursor / gemini` subcommands. Every install is sentinel-guarded (SHA-256 hash fence) for idempotent re-runs and exact uninstall.
- **Structured feedback contract (`aislop.hook.v1`)** the agent receives: score, counts, top-20 findings, `nextSteps`, and a `regressed` flag vs baseline.
- **Quality-gate mode (opt-in, `--quality-gate`)**: `.aislop/baseline.json` captures the score when installed; the Claude Stop hook blocks the session if the score regresses below baseline.
- **`.aislop/hook.lock` recursion guard** (30 s stale window) prevents aislop from scanning itself via its own hook.
- `git diff` fallback for cases where stdin doesn't carry a file path.
- **Swagger / OpenAPI / apidoc JSDoc now recognised as meaningful.** The narrative-comment rule no longer flags `@swagger`, `@openapi`, `@route`, `@group`, `@summary`, `@operationId`, `@response[s]`, `@requestBody`, `@security`, `@tag[s]`, `@path`, `@body`, `@query`, `@header[s]`, `@produces`, `@accept`, `@middleware`, `@api*` (apidoc family), and other legitimate API-doc tags. Existing projects that had `@swagger` blocks auto-deleted on earlier versions can regenerate them safely.

### Changed
- Narrative-comment detection widened (inherited from develop) with better declaration-preamble recognition across TS / JS / Python / Go / Rust / Ruby / Java / PHP.

### Fixed
- `pnpm audit` retired-endpoint (410) now falls back to `npm audit fix` when a `package-lock.json` exists, layered on top of 0.5.1's `pnpm.overrides` writer.
- **`npx aislop scan --json` clean stdout under `npx`.** `scripts/postinstall-tools.mjs` previously wrote `[aislop] Downloading …` progress to stdout. In CI (where npx always re-downloads because there's no cache) this prefix corrupted the JSON envelope, so any consumer parsing `aislop scan --json` got invalid JSON and defaulted to `score: 0`. Fixed by routing all install progress to stderr.
- **Release workflow's GitHub Packages publish.** `setup-node@v6` with only `registry-url` doesn't emit a scope mapping, so scoped package publishes silently fell back to `registry.npmjs.org` and hit `ENEEDAUTH`. Added `scope: '@scanaislop'` and an explicit `--registry` on the publish command so `@scanaislop/aislop` reaches `npm.pkg.github.com`.

### Notes
- 583 tests passing (519 baseline + 64 new). Full coverage across: registry, scan-lock, baseline, adapters (Claude / Cursor / Gemini), install for every supported agent, rules-only uninstall reversibility, and API-doc JSDoc preservation.
- Self-scan: 100 / 100 Healthy.
- Packaged size: 132 kB (15 files).

## 0.5.1 (2026-04-20)

Two bug fixes. One unblocks `aislop fix -f` on pnpm projects, the other makes the file-too-large rule actually honour `maxFileLoc` for JSX/TSX. No new features, no breaking API changes; agent-integration hooks land in 0.6.0 separately.

### Fixed
- **`complexity/file-too-large` now respects config on JSX/TSX**. Previous behaviour silently applied a **2x** multiplier for `.jsx` / `.tsx` files plus a **10% soft buffer**, so `maxFileLoc: 400` actually fired at **881** lines on TSX. The rule is documented as "default max 400 LOC; JSX/TSX 2x" in the skill, but the combined 2x + 10% was neither documented nor configurable, and it meant big React pages sailed past 400 unflagged. New behaviour:
  - `.jsx` / `.tsx` use a **1.5x tolerance** (400 → 600) with **no soft buffer**.
  - Every other extension (`.ts`, `.js`, `.py`, `.go`, `.rs`, `.rb`, `.java`, `.php`, `.mjs`, `.cjs`) hits the exact configured value.
  - This is a tightening for TSX: a `.tsx` file that was fine at 800 lines under 0.5.0 will now flag at 601 lines. If that's a step too far for your repo, bump `.aislop/config.yml` → `maxFileLoc` explicitly.
- **`aislop fix -f` pnpm dep-audit fix**. Previously tried to run `pnpm audit --fix`, which doesn't exist. Now parses `pnpm audit --json` and writes surgical `pnpm.overrides` entries keyed on `<pkg>@<vulnerable_versions>` into the root `package.json`.

### Changed
- Internal refactor: `src/engines/ai-slop/narrative-comments.ts` (416 → 358 lines) splits its pattern regexes into `narrative-comments-patterns.ts`. `src/engines/code-quality/complexity.ts` (416 → 241 lines) splits its function-boundary detection into `function-boundaries.ts`. No behaviour change.

### Tests
- 3 new complexity tests covering the 1.5x JSX tolerance: `.tsx` at 1.5x, `.jsx` at 1.5x, `.ts` at exact limit. Total suite: 516 → 519 passing.

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
- **GitHub Packages publishing**: each release now also publishes `@scanaislop/aislop` to npm.pkg.github.com
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

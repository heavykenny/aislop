# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-12

### Added

- **Unused dependency detection** — 5 new rules powered by knip:
  - `knip/dependencies` — unused packages in package.json
  - `knip/devDependencies` — unused devDependencies in package.json
  - `knip/unlisted` — packages imported but missing from package.json
  - `knip/unresolved` — imports that cannot be resolved
  - `knip/binaries` — binaries used but not declared
- **`aislop fix` removes unused dependencies** — detects and removes unused deps/devDeps from package.json automatically
- **GitHub Packages publishing** — each release now also publishes `@heavykenny/aislop` to npm.pkg.github.com
- **Documentation site** — detailed docs moved to `docs/` directory (installation, commands, rules, configuration, scoring, CI/CD, telemetry)
- **Example configs** — `examples/` directory with 4 preset configurations (typescript-strict, monorepo-relaxed, python-go, architecture-rules)
- **Project infrastructure** — `.editorconfig`, `.nvmrc`, `.gitattributes`, `biome.json`, `AGENTS.md`, `knip.json`
- **Acknowledgments** — README now credits the open-source projects aislop is built on
- npm downloads badge in README

### Changed

- README slimmed from 374 to ~185 lines — reference material moved to docs/
- README restructured: Installation → Usage → Use in project → Why → What it catches
- CONTRIBUTING.md updated to target `develop` branch with AGENTS.md reference
- Expo/React Native documented in supported languages and linting tables
- 288 total tests across 14 test files

## [0.1.3] - 2026-03-12

### Fixed

- Scoring penalties are now proportional to codebase size — a single issue in a 200-file project no longer tanks the score the same as in a 2-file project (fixes #9)
- Add `smoothing` to scoring config schema (was missing, causing TypeScript error)
- Fix `calculateScore` call in scan.ts to pass `sourceFileCount` and `smoothing` as separate arguments (smoothing was previously passed in the sourceFileCount position)
- Compact `countParams` to keep `complexity.ts` under the 400-line limit after biome formatting

### Added

- 52 comprehensive scoring tests covering severity ordering, engine weights, edge cases, and density-aware scoring
- Configurable `scoring.smoothing` option (default: 10) for issue-density normalization
- 285 total tests across 13 test files

## [0.1.2] - 2026-03-11

### Fixed

- False positive: `template.innerHTML` no longer flagged as XSS — `<template>` elements are inert by spec and don't execute scripts (fixes #7)
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
  - `ai-slop/trivial-comment` -- comments that restate the code
  - `ai-slop/swallowed-exception` -- empty catch blocks and catch-only-log
  - `ai-slop/thin-wrapper` -- functions that only delegate
  - `ai-slop/generic-naming` -- AI-style names like `helper_1`, `data2`
  - `ai-slop/unused-import` -- unused imports in JS/TS and Python
  - `ai-slop/console-leftover` -- console.log/debug/info in production code
  - `ai-slop/todo-stub` -- unresolved TODO/FIXME/HACK comments
  - `ai-slop/unreachable-code` -- code after return/throw
  - `ai-slop/constant-condition` -- `if (true)`, `if (false)`
  - `ai-slop/empty-function` -- empty function bodies
  - `ai-slop/unsafe-type-assertion` -- `as any` in TypeScript
  - `ai-slop/double-type-assertion` -- `as unknown as X`
  - `ai-slop/ts-directive` -- `@ts-ignore` / `@ts-expect-error`
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

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

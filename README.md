# slop

`slop` is a unified code quality CLI for multi-language repositories. It runs format, lint, code-quality, AI-pattern, architecture, and security checks behind one command, then summarizes the result as a single score.

## What It Covers

`slop` groups checks into six engines:

- `format`: formatting issues across JS/TS, Python, Go, Rust, Ruby, and PHP where tooling is available
- `lint`: linting for JS/TS, Python, Go, Rust, Ruby, plus Expo health checks
- `code-quality`: function/file complexity, duplication, and JS/TS dead-code checks via `knip`
- `ai-slop`: trivial comments, swallowed exceptions, thin wrappers, and generic naming patterns
- `architecture`: opt-in import/path rules from `.slop/rules.yml`
- `security`: secrets, risky constructs, and dependency audits

## Supported Stacks

Project discovery currently recognizes these languages:

- TypeScript
- JavaScript
- Python
- Go
- Rust
- Java
- Ruby
- PHP

Framework detection currently recognizes:

- Next.js
- React
- Vite
- Remix
- Expo
- Django
- Flask
- FastAPI

Integrated checks are strongest today for JS/TS, Python, Go, Rust, Ruby, and PHP. Java is detected for project metadata, but there is no dedicated Java lint/format integration yet.

## Installation

For local development in this repo:

```bash
pnpm install
```

To use `slop` in another project:

```bash
pnpm add -D slop
```

`slop` ships with Node-based tooling such as `oxlint`, `biome`, and `knip` through package dependencies. On install, it also attempts to download bundled binaries for:

- `ruff`
- `golangci-lint`

If you need to skip those downloads:

```bash
SLOP_SKIP_TOOL_DOWNLOAD=1 pnpm install
```

Some checks still depend on external tools already being present on the machine, such as `gofmt`, `govulncheck`, `cargo`, `rubocop`, `phpcs`, and `php-cs-fixer`.

## Quick Start

Initialize config files:

```bash
pnpm exec slop init
```

Run the default interactive menu:

```bash
pnpm exec slop
```

Run a full scan:

```bash
pnpm exec slop scan
```

Auto-fix supported formatting and lint issues:

```bash
pnpm exec slop fix
```

Emit CI-friendly JSON:

```bash
pnpm exec slop ci
```

Check only changed or staged files:

```bash
pnpm exec slop scan --changes
pnpm exec slop scan --staged
```

## Commands

| Command | Purpose |
| --- | --- |
| `slop` | Launch the interactive TTY menu, or fall back to a scan |
| `slop scan [dir]` | Run all enabled engines |
| `slop fix [dir]` | Apply safe auto-fixes where supported |
| `slop init [dir]` | Create `.slop/config.yml` and `.slop/rules.yml` |
| `slop doctor [dir]` | Report tool availability for the current project |
| `slop ci [dir]` | Output JSON for CI pipelines |
| `slop rules [dir]` | List built-in rule families and configured architecture rules |

Useful flags:

- `--changes`: scan files changed from `HEAD`
- `--staged`: scan staged files only
- `-d, --verbose`: show more detailed file output
- `--json`: print JSON instead of terminal UI

## Configuration

Running `slop init` creates:

- `.slop/config.yml`
- `.slop/rules.yml`

Default config:

```yaml
version: 1

engines:
  format: true
  lint: true
  code-quality: true
  ai-slop: true
  architecture: false
  security: true

quality:
  maxFunctionLoc: 80
  maxFileLoc: 400
  maxNesting: 5
  maxParams: 6

security:
  audit: true
  auditTimeout: 25000

scoring:
  weights:
    format: 0.5
    lint: 1.0
    code-quality: 1.5
    ai-slop: 1.0
    architecture: 1.0
    security: 2.0
  thresholds:
    good: 75
    ok: 50

ci:
  failBelow: 0
  format: json
```

Architecture rules are opt-in. The generated `.slop/rules.yml` includes commented examples for import restrictions and path-boundary rules.

## Score Model

Every diagnostic contributes a weighted penalty based on:

- engine weight
- severity

The final score is normalized to `0-100` and labeled as:

- `Healthy`
- `Needs Work`
- `Critical`

## Development

Project scripts:

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm quality
```

`pnpm test` builds the CLI and runs the Vitest suite.

## Current Notes

- File discovery currently relies on `git ls-files` during scans, so `slop` is most reliable when run inside a Git repository.
- Architecture checks are disabled by default until `.slop/rules.yml` is configured.
- Some engines degrade gracefully when their underlying tools are missing; `slop doctor` shows current coverage.

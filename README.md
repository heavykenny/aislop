# aislop

**Stop AI slop from shipping.**

[![npm version](https://img.shields.io/npm/v/aislop.svg)](https://www.npmjs.com/package/aislop)
[![npm downloads](https://img.shields.io/npm/dm/aislop.svg)](https://www.npmjs.com/package/aislop)
[![CI](https://github.com/heavykenny/aislop/actions/workflows/ci.yml/badge.svg)](https://github.com/heavykenny/aislop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

`aislop` is a unified code-quality CLI that catches the lazy patterns AI coding tools leave behind. One command, one score out of 100.

Every check is deterministic — regex patterns, AST analysis, and standard tooling (Biome, oxlint, knip, ruff). It runs the same way every time, with no API calls, no LLMs, and no network requests (except dependency audits). The name refers to what it *catches*.

`aislop` helps teams review AI-assisted code faster by combining formatting, linting, maintainability, pattern detection, architecture checks, and security checks into a single report.

## See it in action

### Scan

![aislop scan demo](assets/scan.gif)

### Fix

![aislop fix demo](assets/fix.gif)

## Quick start

```bash
# scan your project
npx aislop scan

# auto-fix what can be fixed safely
npx aislop fix

# CI mode (JSON output + quality gate)
npx aislop ci
```

Sample output:

```text
aislop scan v0.4.0

  ✓ Project my-app (typescript)
  Source files: 142

  ✓ Formatting: done (0 issues)
  ! Linting: done (2 warnings)
  ! Code Quality: done (1 warning)
  ✓ Maintainability: done (0 issues)
  ✓ Security: done (0 issues)

------------------------------------------------------------
Summary
  Score: 89/100 (Healthy)
  Issues: 0 errors, 3 warnings
  Auto-fixable: 2
  Files: 142
  Time: 2.3s
------------------------------------------------------------
```

---

## Why aislop

AI coding tools generate code that compiles and passes tests but ships with patterns no engineer would write: trivial comments, swallowed exceptions, unused imports, `as any` casts, oversized functions, and leftover `console.log` calls. These problems are spread across many files and slip through review.

`aislop` gives you one view and one score — fully deterministic, no AI involved.

- **One command, full picture**: formatting + lint + maintainability + pattern detection + security (+ architecture)
- **Deterministic and fast**: regex, AST analysis, and standard tooling — no LLMs, no API keys, no network dependency
- **Score-based quality gate**: use a single 0-100 score in CI and PR checks
- **Weighted scoring**: defaults weight sloppy patterns (dead code, type abuse, swallowed errors) more than style noise
- **Auto-fix support**: remove unused imports, apply lint suggestions, fix deps, and format in one pass
- **Agent handoff**: when auto-fix can't solve it, hand off to Claude Code, Cursor, Codex, or 10+ other agents
- **Software engineering standards**: enforce function/file size limits, nesting limits, dead code cleanup, and safer patterns
- **Works across stacks**: TypeScript, JavaScript, Python, Go, Rust, Ruby, PHP, Expo/React Native
- **Zero-config start**: run `npx aislop scan` and get useful output immediately

## What it catches

Six deterministic engines run in parallel:

| Engine | What it checks | How |
|---|---|---|
| **Formatting** | Code style consistency | Biome, ruff, gofmt, cargo fmt, rubocop, php-cs-fixer |
| **Linting** | Language-specific issues | oxlint, ruff, golangci-lint, clippy, expo-doctor |
| **Code Quality** | Complexity and dead code | Function/file size limits, deep nesting, unused files/deps (knip) |
| **Pattern Detection** | Sloppy code patterns | Trivial comments, swallowed exceptions, unused imports, console leftovers, type assertion abuse, TODO stubs |
| **Security** | Vulnerabilities and risky code | eval, innerHTML, SQL/shell injection, dependency audits (npm/pip/cargo/govulncheck) |
| **Architecture** | Structural rules (opt-in) | Custom import bans, layering rules, required patterns |

See the full [rules reference](docs/rules.md).

---

## Installation

```bash
# Run without installing
npx aislop scan

# npm
npm install --save-dev aislop

# yarn
yarn add --dev aislop

# pnpm
pnpm add -D aislop

# Global
npm install -g aislop
```

Also available as [`@heavykenny/aislop`](docs/installation.md) on GitHub Packages.

---

## Usage

### Scan your project

```bash
aislop scan                # scan current directory
aislop scan ./src          # scan a specific directory
aislop scan --changes      # only files changed from HEAD
aislop scan --staged       # only staged files (pre-commit)
aislop scan --json         # output JSON
```

### Fix issues automatically

```bash
aislop fix                 # auto-fix unused imports, formatting, and lint fixes
aislop fix -f              # aggressive: dependency audit, unused file removal, Expo alignment
aislop fix --claude        # hand off remaining issues to Claude Code
aislop fix --cursor        # open Cursor + copy prompt to clipboard
aislop fix -p              # print prompt to paste into any coding agent
```

### Use in CI pipelines

```bash
aislop ci                  # JSON output, exits 1 if score < threshold
```

### Common workflow

```bash
# before commit
aislop scan --staged

# during local cleanup
aislop fix

# full project check
aislop scan
```

### Other commands

```bash
aislop init                # create .aislop/config.yml
aislop doctor              # check which tools are available
aislop rules               # list all built-in rules
aislop                     # interactive menu
```

See [all commands and flags](docs/commands.md).

---

## Use in your project

### Pre-commit hook

```bash
npx aislop scan --staged
```

### GitHub Actions

```yaml
- uses: actions/setup-node@v6
  with:
    node-version: 20
- run: npm ci
- run: npx aislop ci
```

### Quality gate

Set a minimum score in `.aislop/config.yml`:

```yaml
ci:
  failBelow: 70
```

`aislop ci` exits with code 1 when the score drops below the threshold. See [CI/CD docs](docs/ci.md) for more.

---

## Documentation

| Topic | Link |
|---|---|
| Installation | [docs/installation.md](docs/installation.md) |
| Commands & flags | [docs/commands.md](docs/commands.md) |
| Rules reference | [docs/rules.md](docs/rules.md) |
| Configuration | [docs/configuration.md](docs/configuration.md) |
| Scoring | [docs/scoring.md](docs/scoring.md) |
| CI / CD | [docs/ci.md](docs/ci.md) |
| Telemetry | [docs/telemetry.md](docs/telemetry.md) |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and how to add new rules. AI coding assistants can find project context in [AGENTS.md](AGENTS.md).

## Acknowledgments

`aislop` is built on top of excellent open-source projects:

- [Biome](https://biomejs.dev/) — formatting and linting for JS/TS
- [oxlint](https://oxc.rs/) — fast JavaScript/TypeScript linter
- [knip](https://knip.dev/) — unused files, exports, and dependencies
- [ruff](https://docs.astral.sh/ruff/) — Python linting and formatting
- [golangci-lint](https://golangci-lint.run/) — Go linting
- [expo-doctor](https://docs.expo.dev/) — Expo/React Native project health

## Contributors

[![Contributors](https://contrib.rocks/image?repo=heavykenny/aislop)](https://github.com/heavykenny/aislop/graphs/contributors)

## License

[MIT](LICENSE)

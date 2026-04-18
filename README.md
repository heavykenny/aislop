# aislop

**Stop AI slop from shipping.**

[![npm version](https://img.shields.io/npm/v/aislop.svg)](https://www.npmjs.com/package/aislop)
[![npm downloads](https://img.shields.io/npm/dm/aislop.svg)](https://www.npmjs.com/package/aislop)
[![CI](https://github.com/heavykenny/aislop/actions/workflows/ci.yml/badge.svg)](https://github.com/heavykenny/aislop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

`aislop` is a unified code-quality CLI that catches the lazy patterns AI coding tools leave behind. One command, one score out of 100.

Every check is deterministic — regex patterns, AST analysis, and standard tooling (Biome, oxlint, knip, ruff). It runs the same way every time, with no API calls, no LLMs, and no network requests (except dependency audits). The name refers to what it *catches*.

`aislop` helps teams review AI-assisted code faster by combining formatting, linting, code quality, AI-slop detection, architecture checks, and security checks into a single report.

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
 [ok] Formatting: done (0 issues, 426ms)
 [ok] Linting: done (0 issues, 396ms)
 [!]  Code Quality: done (2 warnings, 812ms)
 [!]  AI Slop: done (4 warnings, 455ms)
 [ok] Security: done (0 issues, 1.3s)
 aislop 0.5.0  ·  the quality gate for agentic coding

 scan  ·  my-app  ·  typescript  ·  142 files

  > Code Quality
    [WARN] [auto] Unused export (2)
      src/lib/format-bytes.ts:12
      src/utils/retry.ts:8

  > AI Slop
    [WARN] [auto] Narrative comment block (2)
      src/lib/auth.ts:86
    [WARN] 'as any' bypasses type safety
      src/api/normalize.ts:47

   87 / 100  Healthy       0 errors  ·  6 warnings  ·  4 fixable
   142 files  ·  5 engines  ·  1.9s

 → Run npx aislop fix to auto-fix 4 issues
 → Run npx aislop fix --claude to hand off the rest to an agent
```

---

## Why aislop

AI coding tools generate code that compiles and passes tests but ships with patterns no engineer would write: trivial comments, swallowed exceptions, unused imports, `as any` casts, oversized functions, and leftover `console.log` calls. These problems are spread across many files and slip through review.

`aislop` gives you one view and one score — fully deterministic, no AI involved.

- **One command, full picture**: formatting + lint + code quality + AI-slop detection + security (+ architecture)
- **Deterministic and fast**: regex, AST analysis, and standard tooling — no LLMs, no API keys, no network dependency
- **Score-based quality gate**: use a single 0-100 score in CI and PR checks
- **Weighted scoring**: defaults weight sloppy patterns (dead code, type abuse, swallowed errors) more than style noise
- **Auto-fix support**: remove unused imports, apply lint suggestions, fix deps, and format in one pass
- **Agent handoff**: when auto-fix can't solve it, one flag hands remaining issues to Claude Code, Codex, Cursor, Gemini, Windsurf, Amp, Aider, Goose, and more (14 agents supported)
- **Software engineering standards**: enforce function/file size limits, nesting limits, dead code cleanup, and safer patterns
- **Works across stacks**: TypeScript, JavaScript, Python, Go, Rust, Ruby, PHP, Expo/React Native
- **Zero-config start**: run `npx aislop scan` and get useful output immediately

## What it catches

Six deterministic engines run in parallel:

| Engine | What it checks | How |
|---|---|---|
| **Formatting** | Code style consistency | Biome, ruff, gofmt, cargo fmt, rubocop, php-cs-fixer |
| **Linting** | Language-specific issues | oxlint, ruff, golangci-lint, clippy, expo-doctor |
| **Code Quality** | Complexity and dead code | Function/file size limits, deep nesting, unused files/deps (knip), AST-based unused-declaration removal |
| **AI Slop** | AI-authored code patterns | Narrative comments, trivial comments, dead patterns, unused imports, `as any`, `console.log` leftovers, TODO stubs, generic names |
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

### Hand off to your coding agent

When auto-fix can't solve it, aislop generates a prompt with full context and opens your agent:

```bash
aislop fix --claude        # Claude Code
aislop fix --codex         # Codex CLI
aislop fix --cursor        # Cursor (copies prompt to clipboard)
aislop fix --windsurf      # Windsurf (copies prompt to clipboard)
aislop fix --gemini        # Gemini CLI
aislop fix --amp           # Amp
aislop fix --vscode        # VS Code (copies prompt to clipboard)
aislop fix --aider         # Aider
aislop fix --goose         # Goose
aislop fix --opencode      # OpenCode
aislop fix --warp          # Warp
aislop fix --kimi          # Kimi Code CLI
aislop fix --antigravity   # Antigravity
aislop fix --deep-agents   # Deep Agents
aislop fix --prompt        # print prompt to paste into any agent
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

Fastest path: run `npx aislop init` and say yes to "Add a GitHub Actions workflow?" — it drops a working `.github/workflows/aislop.yml` for you.

Manual form:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npx aislop@latest ci .
```

Or use the composite action (one-liner):

```yaml
- uses: actions/checkout@v4
- uses: heavykenny/aislop@v0.5
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

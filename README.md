# aislop

**The engineering standards layer and quality gate for AI-written code.**

[![npm version](https://img.shields.io/npm/v/aislop.svg)](https://www.npmjs.com/package/aislop)
[![npm downloads](https://img.shields.io/npm/dm/aislop.svg)](https://www.npmjs.com/package/aislop)
[![CI](https://github.com/scanaislop/aislop/actions/workflows/ci.yml/badge.svg)](https://github.com/scanaislop/aislop/actions/workflows/ci.yml)
[![aislop score](https://badges.scanaislop.com/score/scanaislop/aislop.svg)](https://scanaislop.com/scanaislop/aislop)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

Catches the slop AI agents leave behind: dead code, oversized functions and files, unused imports, `as any` casts, swallowed errors, hallucinated imports, todo stubs, narrative comments. Scores 0–100. Deterministic (regex + AST, no LLMs). 8+ languages.

## Quick start

```bash
npx aislop scan
```

No install needed. Works on any project. Get your score in seconds.

```bash
npx aislop fix                   # auto-fix issues
npx aislop fix -f                # aggressive fixes (deps, unused files)
npx aislop ci                    # CI mode (JSON + gate)
npx aislop hook install --claude # per-edit hook
```

**Public badge**: Show your score on your README

```markdown
[![aislop](https://badges.scanaislop.com/score/<owner>/<repo>.svg)](https://scanaislop.com)
```

Run `npx aislop badge` to auto-generate. Free at [scanaislop.com](https://scanaislop.com).

## See it in action

### Scan

![aislop scan demo](assets/scan.gif)

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

Also available as [`@scanaislop/aislop`](docs/installation.md) on GitHub Packages.

---

## Usage

### Scan

```bash
npx aislop scan           # current directory
npx aislop scan ./src     # specific directory
npx aislop scan --changes # changed files from HEAD
npx aislop scan --staged  # staged files only
npx aislop scan --json    # JSON output
```

**Exclude files**: `node_modules`, `.git`, `dist`, `build`, `coverage` excluded by default. Add more in `.aislop/config.yml`:

```yaml
exclude:
  - "**/*.test.ts"
  - src/generated
```

Or via CLI: `npx aislop scan --exclude "**/*.test.ts,dist"`

**Extend config**: Project config can extend a parent:

```yaml
# .aislop/config.yml
extends: ../../.aislop/base.yml
ci:
  failBelow: 80             # override specific keys
```

### Fix

Auto-fix what's mechanical (formatters, unused imports, dead code). For issues that need context, hand off to your agent with full diagnostic info.

```bash
npx aislop fix                 # safe auto-fixes
npx aislop fix -f              # aggressive: deps, unused files
```

### Hand off to agent

When auto-fix can't solve it, pass the remaining issues to your coding agent with full context:

```bash
npx aislop fix --claude        # Claude Code
npx aislop fix --cursor        # Cursor (copies to clipboard)
npx aislop fix --gemini        # Gemini CLI
npx aislop fix --codex         # Codex CLI
# Also: --windsurf, --amp, --aider, --goose, --opencode, --warp, --kimi, --antigravity, --deep-agents, --vscode
npx aislop fix --prompt        # print prompt (agent-agnostic)
```

### Install hook

Runs after every agent edit. Feedback flows back immediately.

```bash
npx aislop hook install --claude           # Claude Code
npx aislop hook install --cursor           # Cursor
npx aislop hook install --gemini           # Gemini CLI
npx aislop hook install                    # all supported agents
npx aislop hook install claude cursor      # specific agents
```

**Runtime adapters** (scan + feedback): `claude`, `cursor`, `gemini`.  
**Rules-only** (agent reads rules): `codex`, `windsurf`, `cline`, `kilocode`, `antigravity`, `copilot`.

**Quality-gate mode**: Blocks if score regresses below baseline.

```bash
npx aislop hook install --claude --quality-gate
npx aislop hook baseline                    # re-capture baseline
npx aislop hook status                      # list installed
npx aislop hook uninstall --claude          # remove
```

Docs: [`/docs/hooks`](https://scanaislop.com/docs/hooks)

### MCP server

Expose aislop as MCP tools for Claude Desktop, Cursor, Codex:

```jsonc
// ~/.cursor/mcp.json or Claude Desktop config
{
  "mcpServers": {
    "aislop": {
      "command": "npx",
      "args": ["-y", "aislop-mcp"]
    }
  }
}
```

**Tools**: `aislop_scan`, `aislop_fix`, `aislop_why`, `aislop_baseline`

### CI

```bash
npx aislop ci                  # JSON output, exits 1 if score < threshold
```

### Other commands

```bash
npx aislop init                # create .aislop/config.yml
npx aislop rules               # list rules
npx aislop badge               # print badge URL
npx aislop                     # interactive menu
```

Docs: [commands](docs/commands.md)

---

## CI integration

### Pre-commit

```bash
npx aislop scan --staged
```

### GitHub Actions

Run `npx aislop init` and accept the workflow prompt, or add manually:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npx aislop@latest ci .
```

**Composite action**:

```yaml
- uses: actions/checkout@v4
- uses: scanaislop/aislop@v0.8
```

### Quality gate

Set minimum score in `.aislop/config.yml`:

```yaml
ci:
  failBelow: 70
```

`aislop ci` exits 1 when score < threshold. Docs: [CI/CD](docs/ci.md)

---

## For teams

[scanaislop](https://scanaislop.com) is the hosted platform for teams:

- PR gates with score thresholds
- Standards hierarchy (org → team → project)
- Dashboards and agent attribution
- Visual rules manager

Same engines, same scores. CLI is MIT-licensed. [Learn more →](https://scanaislop.com)

---

## Why aislop

AI coding tools generate code that compiles and passes tests but ships with patterns no engineer would write. `aislop` gives you one score, one gate, and auto-fixes what it can.

- **One score**: 0-100, enforced in CI. Weighted so sloppy patterns hit harder than style noise.
- **Auto-fix first**: Clears formatters, unused imports, dead code mechanically. Hands off the rest to your agent with full context.
- **Deterministic**: Regex + AST + standard tooling. No LLMs, no API calls. Same code in, same score out.
- **Zero-config start**: `npx aislop scan` works on any repo. Add `.aislop/config.yml` to tune.

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

## Docs

[Installation](docs/installation.md) · [Commands](docs/commands.md) · [Rules](docs/rules.md) · [Config](docs/configuration.md) · [Scoring](docs/scoring.md) · [CI/CD](docs/ci.md) · [Telemetry](docs/telemetry.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). AI assistants: [AGENTS.md](AGENTS.md).

## Acknowledgments

Built on: [Biome](https://biomejs.dev/), [oxlint](https://oxc.rs/), [knip](https://knip.dev/), [ruff](https://docs.astral.sh/ruff/), [golangci-lint](https://golangci-lint.run/), [expo-doctor](https://docs.expo.dev/)

## Contributors

<!-- CONTRIBUTORS-START -->
- [@heavykenny](https://github.com/heavykenny)
- [@myke-awoniran](https://github.com/myke-awoniran)
- [@yashrajoria](https://github.com/yashrajoria)
<!-- CONTRIBUTORS-END -->

Auto-updated by `.github/workflows/contributors.yml`. [Link commit email](https://github.com/settings/emails) or add to [`.github/contributors-overrides.json`](.github/contributors-overrides.json).

## License

[MIT](LICENSE)

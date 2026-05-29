# aislop

**Catch the slop AI coding agents leave in your code.**

[![npm version](https://img.shields.io/npm/v/aislop.svg)](https://www.npmjs.com/package/aislop)
[![npm downloads](https://img.shields.io/npm/dm/aislop.svg)](https://www.npmjs.com/package/aislop)
[![CI](https://github.com/scanaislop/aislop/actions/workflows/ci.yml/badge.svg)](https://github.com/scanaislop/aislop/actions/workflows/ci.yml)
[![aislop score](https://badges.scanaislop.com/score/scanaislop/aislop.svg)](https://scanaislop.com/scanaislop/aislop)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

The patterns Claude Code, Cursor, Codex, and OpenCode leave behind: narrative comments above self-explanatory code, swallowed exceptions, `as any` casts, hallucinated imports, duplicated helpers, dead code, todo stubs, oversized functions. Tests pass. Lint passes. The code rots anyway.

aislop catches them. 40+ rules across 7 languages (TS/JS, Python, Go, Rust, Ruby, PHP, Java). Scores every change 0–100. Sub-second. Deterministic — no LLM in the runtime path, same code in, same score out. MIT-licensed, free CLI.

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
npx aislop scan --sarif   # SARIF 2.1.0 output (GitHub code scanning)
```

**Exclude files**: `node_modules`, `.git`, `dist`, `build`, `coverage` excluded by default. Add more in `.aislop/config.yml`:

```yaml
exclude:
  - "**/*.test.ts"
  - src/generated
```

Or via CLI: `npx aislop scan --exclude "**/*.test.ts,dist"`

**Per-rule severity**: Override the severity of any rule by id, or turn it off:

```yaml
# .aislop/config.yml
rules:
  ai-slop/narrative-comment: warning   # error | warning | off
  ai-slop/trivial-comment: "off"       # drop this rule entirely
  security/hardcoded-secret: error
```

`off` drops matching diagnostics; `error`/`warning` rewrites severity before scoring and reporting. Absent map keeps default behavior.

**Extend config**: Project config can extend a parent:

```yaml
# .aislop/config.yml
extends: ../../.aislop/base.yml
ci:
  failBelow: 80             # override specific keys
```

**Editor validation**: Point your editor at the JSON Schema in [`schema/aislop.config.schema.json`](schema/aislop.config.schema.json) for autocomplete and validation of `.aislop/config.yml`. Regenerate it from the source config schema with `pnpm gen:schema`.

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
# Also: --windsurf, --amp, --aider, --goose, --pi, --crush, --opencode, --warp, --kimi, --antigravity, --deep-agents, --vscode
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
npx aislop init --strict       # enterprise-grade gate: all engines, typecheck, failBelow 85
npx aislop rules               # list rules
npx aislop badge               # print badge URL
npx aislop trend               # show score history over time
npx aislop                     # interactive menu
```

**Score history**: a normal (full-project, interactive) `scan` appends a compact record to `.aislop/history.jsonl` (timestamp, score, error/warning counts, file count, CLI version). `aislop trend` reads it and prints a table plus an ASCII sparkline of recent scores. History is a local side effect only: it is never written for `--json`/`--sarif` output, in CI, or when `AISLOP_NO_HISTORY=1` is set, so machine output stays clean.

Docs: [commands](docs/commands.md)

---

## CI integration

### Pre-commit

Run directly on staged files:

```bash
npx aislop scan --staged
```

Or wire it into the [pre-commit](https://pre-commit.com) framework via the bundled hook:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/scanaislop/aislop
    rev: v0.9.4
    hooks:
      - id: aislop
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

**GitHub code scanning (SARIF)**: emit a SARIF 2.1.0 report and upload it so findings appear in the Security tab:

```yaml
- run: npx aislop@latest scan . --sarif > aislop.sarif
- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: aislop.sarif
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

## Research

aislop rules are shaped by public scans and benchmark-derived failure modes, not only local fixtures. The [research program](docs/research-program.md) defines how to run repeatable open-source scans: pin the cohort, store raw JSON, classify findings, fix noisy rules with regression tests, and publish the limits.

---

## Docs

[Installation](docs/installation.md) · [Commands](docs/commands.md) · [Rules](docs/rules.md) · [Config](docs/configuration.md) · [Scoring](docs/scoring.md) · [CI/CD](docs/ci.md) · [Telemetry](docs/telemetry.md) · [Research program](docs/research-program.md)

## Community

[Discussions](https://github.com/scanaislop/aislop/discussions) for questions, rule requests, and false-positive triage · [Issues](https://github.com/scanaislop/aislop/issues) for bugs

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

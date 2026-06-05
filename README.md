# aislop

**Catch the slop AI coding agents leave in your code.**

[![npm version](https://img.shields.io/npm/v/aislop.svg)](https://www.npmjs.com/package/aislop)
[![npm downloads](https://img.shields.io/npm/dm/aislop.svg)](https://www.npmjs.com/package/aislop)
[![PyPI downloads](https://img.shields.io/pepy/dt/aislop.svg?label=PyPI%20downloads)](https://pypi.org/project/aislop/)
[![Homebrew tap](https://img.shields.io/badge/Homebrew-scanaislop%2Ftap-2f855a.svg)](https://github.com/scanaislop/homebrew-tap)
[![CI](https://github.com/scanaislop/aislop/actions/workflows/ci.yml/badge.svg)](https://github.com/scanaislop/aislop/actions/workflows/ci.yml)
[![aislop score](https://badges.scanaislop.com/score/scanaislop/aislop.svg)](https://scanaislop.com/scanaislop/aislop)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

The patterns Claude Code, Cursor, Codex, and OpenCode leave behind: narrative comments above self-explanatory code, swallowed exceptions, `as any` casts, hallucinated imports, duplicated helpers, dead code, todo stubs, oversized functions. Tests pass. Lint passes. The code rots anyway.

aislop catches them. 50+ rules across 8 language targets (TypeScript, JavaScript, Expo / React Native, Python, Go, Rust, Ruby, PHP). Scores every change 0–100. Sub-second. Deterministic — no LLM in the runtime path, same code in, same score out. MIT-licensed, free CLI.

## Quick start

```bash
npx aislop@latest scan
```

No install needed. Works on any project. Get your score in seconds.

Prefer a persistent install? The same CLI ships through three channels:

```bash
brew install scanaislop/tap/aislop   # macOS / Linux (Homebrew)
pipx install aislop                  # Python (pipx)
npm install -g aislop                # Node (global)
```

See [Installation](#installation) for every option.

```bash
aislop fix                   # auto-fix issues after installing
aislop fix -f                # aggressive fixes (deps, unused files)
aislop ci                    # CI mode (JSON + gate)
aislop hook install --claude # per-edit hook
```

**Public badge**: Show your score on your README

```markdown
[![aislop](https://badges.scanaislop.com/score/<owner>/<repo>.svg)](https://scanaislop.com)
```

Run `npx aislop@latest badge` to auto-generate. Free at [scanaislop.com](https://scanaislop.com).

## See it in action

### Scan

![aislop scan demo](assets/scan.gif)

---

## Installation

The same CLI is published to npm, Homebrew, and PyPI. Pick whichever fits your stack.

**Node / npm**

```bash
# Run without installing
npx aislop@latest scan

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

**Homebrew** (macOS / Linux)

```bash
brew install scanaislop/tap/aislop
```

Homebrew installs Node.js as a dependency if it isn't already present. Details: [homebrew-tap](https://github.com/scanaislop/homebrew-tap).

**Python / pipx**

```bash
pipx install aislop
```

`pipx` keeps `aislop` in its own isolated environment. Needs Node.js on `PATH`. Details: [PyPI package](https://pypi.org/project/aislop/).

Full reference for every channel, bundled tooling, and external tools: [docs/installation.md](docs/installation.md).

---

## Usage

Examples below use the installed `aislop` binary. For a one-off latest run, prefix the command with `npx aislop@latest`, for example `npx aislop@latest scan`.

### Command reference

```bash
aislop --help              # clean overview
aislop commands            # every public command and major flag
aislop <command> --help    # detailed help for one command
aislop version             # installed version
aislop -V                  # installed version
aislop update              # current and latest npm versions
```

### Scan

```bash
aislop scan                       # current directory
aislop scan ./src                 # specific directory
aislop scan --changes             # changed files from HEAD
aislop scan --staged              # staged files only
aislop scan -d                    # verbose file/rule detail
aislop scan --json                # JSON output
aislop scan --sarif               # SARIF 2.1.0 output (GitHub code scanning)
aislop scan --format json         # alternate JSON form
aislop scan --include "src/**"    # only matching paths
aislop scan --exclude "dist,gen"  # skip extra paths
```

**Exclude files**: `node_modules`, `.git`, `dist`, `build`, `coverage` excluded by default. Add more in `.aislop/config.yml`:

```yaml
exclude:
  - "**/*.test.ts"
  - src/generated
```

Or via CLI: `aislop scan --exclude "**/*.test.ts,dist"`

**Unsupported languages**: aislop only analyses the 8 language targets above. If a repo is mostly something else (C, C++, C#, Swift, Kotlin, …), scoring a handful of incidental files would misrepresent it, so aislop **withholds the score** and says so rather than printing a number off code it never read. `--json` returns `score: null`, `scoreable: false`, and a `coverage` breakdown.

**Per-rule severity**: Override the severity of any rule by id, or turn it off:

```yaml
# .aislop/config.yml
rules:
  ai-slop/narrative-comment: warning   # error | warning | off
  ai-slop/trivial-comment: "off"       # drop this rule entirely
  security/hardcoded-secret: error
```

`off` drops matching diagnostics; `error`/`warning` rewrites severity before scoring and reporting. Absent map keeps default behavior.

**Suppress findings inline**: Silence a specific line when you know better, with an optional reason after `--`:

```ts
// aislop-ignore-next-line ai-slop/empty-fallback -- options is validated upstream
const opts = { ...defaults, ...(input || {}) };

const legacy = doThing(); // aislop-ignore-line
```

`aislop-ignore-next-line` covers the line below, `aislop-ignore-line` the line it sits on, and `aislop-ignore-file` (place anywhere in the file) the whole file. Name one or more rules to scope the suppression, or omit them to silence every rule on that line. The directive works in any comment syntax (`//`, `#`, `<!-- -->`). Suppressed findings are removed before scoring, and the run reports how many were silenced.

**Ignore whole paths**: Add an `.aislopignore` at the project root (same glob semantics as `exclude`, `#` comments allowed):

```
src/generated
**/*.snap
legacy
```

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
aislop fix                 # auto-fixes
aislop fix -d              # detailed fix progress
aislop fix --safe          # only reversible fixes (imports, comment removal, formatting)
aislop fix -f              # aggressive: deps, unused files
aislop fix -p              # print an agent handoff prompt
```

`--safe` restricts the run to fixes that cannot change behaviour — unused-import removal, import merging, narrative-comment removal, and formatting. Anything that deletes code or rewrites behaviour/attributes (console/dead-code removal, lint autofixes, unused-declaration and dependency pruning) is skipped, so a `--safe` run is genuinely "apply and commit".

### Hand off to agent

When auto-fix can't solve it, pass the remaining issues to your coding agent with full context:

```bash
aislop fix --claude        # Claude Code
aislop fix --codex         # Codex CLI
aislop fix --cursor        # Cursor (copies to clipboard)
aislop fix --gemini        # Gemini CLI
aislop fix --prompt        # print prompt (agent-agnostic)
```

Other fix handoff flags: `--windsurf`, `--vscode`, `--amp`, `--antigravity`, `--deep-agents`, `--kimi`, `--opencode`, `--warp`, `--aider`, `--goose`, `--pi`, `--crush`.

### Install hook

Runs after every agent edit. Feedback flows back immediately.

```bash
aislop hook install --claude           # Claude Code
aislop hook install --cursor           # Cursor
aislop hook install --gemini           # Gemini CLI
aislop hook install --pi               # pi
aislop hook install                    # pick agents interactively
aislop hook install claude cursor      # specific agents
aislop hook install --agent claude,pi  # comma-separated agents
aislop install claude cursor           # alias for hook install
aislop install hooks --claude          # natural alias for hook install
```

**Runtime adapters** (scan + feedback): `claude`, `cursor`, `gemini`, `pi`.  
**Rules-only** (agent reads rules): `codex`, `windsurf`, `cline`, `kilocode`, `antigravity`, `copilot`.

Hook install flags: `--agent <names>`, `-g, --global`, `--project`, `--dry-run`, `--yes`, `--quality-gate`, plus per-agent shortcuts `--claude`, `--cursor`, `--gemini`, `--pi`, `--codex`, `--windsurf`, `--cline`, `--kilocode`, `--antigravity`, `--copilot`.

**Quality-gate mode**: Blocks if score regresses below baseline.

```bash
aislop hook install --claude --quality-gate
aislop hook baseline                    # re-capture baseline
aislop hook status                      # list installed
aislop hook uninstall --claude          # remove
aislop uninstall claude                  # alias for hook uninstall
aislop uninstall hooks --claude          # natural alias for hook uninstall
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
aislop ci                  # JSON output, exits 1 if score < threshold
aislop ci --human          # human-friendly CI output
aislop ci --sarif          # SARIF output for code scanning
```

### Other commands

```bash
aislop                         # interactive menu
aislop init                    # create .aislop/config.yml
aislop init --strict           # enterprise-grade gate: all engines, typecheck, failBelow 85
aislop doctor                  # check which engines can run here
aislop rules                   # list rules
aislop rules --search          # searchable rule explorer
aislop badge                   # print badge URL
aislop badge --owner o --repo r --json
aislop trend                   # show score history over time
aislop trend --limit 20
aislop update                  # show current and latest npm versions
aislop upgrade                 # alias for update
aislop commands                # full command list
```

**Score history**: a normal (full-project, interactive) `scan` appends a compact record to `.aislop/history.jsonl` (timestamp, score, error/warning counts, file count, CLI version). `aislop trend` reads it and prints a table plus an ASCII sparkline of recent scores. History is a local side effect only: it is never written for `--json`/`--sarif` output, in CI, or when `AISLOP_NO_HISTORY=1` is set, so machine output stays clean.

Docs: [commands](docs/commands.md)

---

## CI integration

### Pre-commit

Run directly on staged files:

```bash
aislop scan --staged
```

Or wire it into the [pre-commit](https://pre-commit.com) framework via the bundled hook:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/scanaislop/aislop
    rev: v0.10.2
    hooks:
      - id: aislop
```

### GitHub Actions

Run `aislop init` and accept the workflow prompt, or add manually:

```yaml
name: aislop

on:
  pull_request:
  push:
    branches: [main]

jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: scanaislop/aislop@v0.10.2
        with:
          version: latest
```

`uses: scanaislop/aislop@v0.10.2` pins the GitHub Action wrapper. `version: latest` follows the latest npm CLI. For fully deterministic CI, set both to the same release:

```yaml
- uses: actions/checkout@v4

- uses: scanaislop/aislop@v0.10.2
  with:
    version: "0.10.2"
```

Manual workflow without the Marketplace Action:

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 20
- run: npx --yes aislop@latest ci .
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
- **Zero-config start**: `npx aislop@latest scan` works on any repo. Add `.aislop/config.yml` to tune.

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

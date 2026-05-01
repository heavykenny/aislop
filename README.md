# aislop

**The quality gate for agentic coding.**

[![npm version](https://img.shields.io/npm/v/aislop.svg)](https://www.npmjs.com/package/aislop)
[![npm downloads](https://img.shields.io/npm/dm/aislop.svg)](https://www.npmjs.com/package/aislop)
[![CI](https://github.com/scanaislop/aislop/actions/workflows/ci.yml/badge.svg)](https://github.com/scanaislop/aislop/actions/workflows/ci.yml)
[![aislop score](https://badges.scanaislop.com/score/scanaislop/aislop.svg)](https://scanaislop.com/scanaislop/aislop)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

`aislop` scans the code your agent wrote and gives you one score, 0–100. It rolls formatters, linters, complexity limits, dependency audits, and an AI-slop detector into a single command. It auto-fixes what's safely fixable and hands the rest to your coding agent with full context.

Every check is deterministic. Regex patterns, AST analysis, and standard tooling (Biome, oxlint, knip, ruff). Same code in, same score out. No API calls, no LLMs, no network dependency (except optional dependency audits). The name refers to what it *catches*.

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

# wire aislop into your agent so it runs on every edit
npx aislop hook install --claude
```

Sample output:

```text
 [ok] Formatting: done (0 issues, 426ms)
 [ok] Linting: done (0 issues, 396ms)
 [!]  Code Quality: done (2 warnings, 812ms)
 [!]  AI Slop: done (4 warnings, 455ms)
 [ok] Security: done (0 issues, 1.3s)
 aislop 0.7.0  ·  the quality gate for agentic coding

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

`aislop` gives you one view and one score. Fully deterministic, no AI in the loop.

- **One score, one gate**: a 0-100 number you can enforce in CI with `aislop ci`. Weighted so sloppy patterns (dead code, `as any`, swallowed errors) hit harder than style noise.
- **Auto-fix first, agent second**: `aislop fix` clears what's mechanically safe (formatters, unused imports, trivial comments, dead patterns). For the rest, one flag hands off to Claude Code, Codex, Cursor, Gemini, Windsurf, Amp, Aider, Goose, and 7 more, with full diagnostic context pre-filled.
- **Wire it into your agent**: `aislop hook install` plugs aislop into Claude Code, Cursor, Gemini CLI (runtime), plus Codex, Windsurf, Cline, Kilo Code, Antigravity, and Copilot (rules-only). The agent gets score + findings on the turn it wrote the code, not after.
- **Deterministic**: regex, AST, and standard tooling. No LLMs, no API keys, no network dependency. Same repo in, same score out.
- **Zero-config start**: `npx aislop scan` works on any repo. Add `.aislop/config.yml` when you want to tune thresholds or enable the architecture engine.
- **Works across stacks**: TypeScript, JavaScript, Python, Go, Rust, Ruby, PHP, Expo / React Native.

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

Also available as [`@scanaislop/aislop`](docs/installation.md) on GitHub Packages.

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

**Exclude files and directories.** `node_modules`, `.git`, `dist`, `build`, and `coverage` are excluded by default. Add more via `.aislop/config.yml`:

```yaml
exclude:
  - "**/*.test.ts"          # globs supported (micromatch)
  - src/generated
  - legacy
```

Or override per-run with `--exclude` (comma-separated or repeatable, stacks on top of the config):

```bash
aislop scan --exclude "**/*.test.ts"
aislop scan --exclude node_modules,dist,logs
aislop scan --exclude "src/generated" --exclude "**/*.spec.*"
```

CLI flags beat config; config beats defaults.

**Extend a shared config.** A project config can extend a parent and override specific keys. Useful for org-wide baselines: ship one strict config, let each repo soften or tighten as needed.

```yaml
# .aislop/config.yml
extends: ../../.aislop/base.yml   # relative path to a parent config

ci:
  failBelow: 80                   # override just this key, inherit the rest
```

`extends:` accepts a single path or an array of paths. Later entries win. Deep-merged: nested objects (`scoring.weights`, `engines`) are merged key-by-key; arrays are replaced. Circular references and depths beyond 5 are rejected with a clear error.

### Fix issues automatically

```bash
aislop fix                 # safe auto-fixes: unused imports, formatting, lint
aislop fix -f              # aggressive: dependency audit, unused files, Expo alignment
```

### Hand off to your coding agent

When auto-fix can't solve it, aislop generates a prompt with full context and opens your agent. 14 supported:

```bash
aislop fix --claude        # Claude Code
aislop fix --codex         # Codex CLI
aislop fix --cursor        # Cursor (copies prompt to clipboard)
aislop fix --gemini        # Gemini CLI
aislop fix --windsurf      # Windsurf (copies prompt to clipboard)
aislop fix --amp           # Amp
aislop fix --aider         # Aider
aislop fix --goose         # Goose
aislop fix --opencode      # OpenCode
aislop fix --warp          # Warp
aislop fix --kimi          # Kimi Code CLI
aislop fix --antigravity   # Antigravity
aislop fix --deep-agents   # Deep Agents
aislop fix --vscode        # VS Code Copilot (copies prompt to clipboard)
aislop fix --prompt        # print the prompt (agent-agnostic)
```

### Install as a native hook

One command and aislop runs automatically after every agent edit. Findings flow back to the agent as structured feedback (`aislop.hook.v1`) with score, counts, top-20 findings, and next steps, so the agent can self-correct on the same turn.

```bash
aislop hook install --claude           # Claude Code PostToolUse
aislop hook install --cursor           # Cursor afterFileEdit
aislop hook install --gemini           # Gemini CLI AfterTool
aislop hook install                    # every supported agent at once
aislop hook install claude cursor      # pick any subset as positional args
aislop hook install --agent claude,cursor   # comma-list if you prefer one flag
```

Runtime adapters (scan + feedback on every edit): `claude`, `cursor`, `gemini`.

Rules-only installers (agent reads rules on every turn): `codex`, `windsurf`, `cline`, `kilocode`, `antigravity`, `copilot`.

Opt-in quality-gate mode captures `.aislop/baseline.json` at install time and blocks the Claude Stop hook if the score regresses:

```bash
aislop hook install --claude --quality-gate
aislop hook baseline                    # re-capture baseline
aislop hook status                      # list installed hooks
aislop hook uninstall --claude          # remove a specific agent
aislop hook uninstall                   # remove every aislop entry, sentinel-verified
```

Every install is sentinel-guarded (SHA-256 hash fence) for idempotent re-runs and exact uninstall. Full guide: [`/docs/hooks`](https://scanaislop.com/docs/hooks).

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
aislop badge               # print the public score badge URL + README snippet
aislop hook install        # wire aislop into your coding agent
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

Fastest path: run `npx aislop init` and say yes to "Add a GitHub Actions workflow?". It drops a working `.github/workflows/aislop.yml` for you.

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
- uses: scanaislop/aislop@v0.5
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

## For engineering teams

`aislop` runs locally and in your CI. [scanaislop](https://scanaislop.com) is the hosted platform built on top of it for teams that want enforcement without wiring every workflow themselves.

- **PR gates on every repo** with a score threshold and block-to-merge
- **Standards hierarchy**: org baseline, team overrides, project config
- **Per-team dashboards** and agent attribution over time
- **Visual rules manager** so engineering leads set standards without editing YAML
- **Same engines, same rule IDs, same score**. The CLI remains the source of truth.

The CLI is MIT-licensed and always will be. [Learn more about the platform →](https://scanaislop.com)

## Public score badge

Show your aislop score on a README. Free for any project that opts in on [scanaislop.com](https://scanaislop.com).

```markdown
[![aislop](https://badges.scanaislop.com/score/<owner>/<repo>.svg)](https://scanaislop.com)
```

Shields-compatible SVG, edge-cached on Cloudflare. Colour-coded: green ≥ 85, amber 70-84, red < 70, grey if no scans yet.

Run `aislop badge` to print the snippet pre-filled with your repo's owner/name, auto-detected from `git remote get-url origin`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and how to add new rules. AI coding assistants can find project context in [AGENTS.md](AGENTS.md).

## Acknowledgments

`aislop` is built on top of excellent open-source projects:

- [Biome](https://biomejs.dev/) for formatting and linting JS/TS
- [oxlint](https://oxc.rs/) for fast JS/TS linting
- [knip](https://knip.dev/) for unused files, exports, and dependencies
- [ruff](https://docs.astral.sh/ruff/) for Python linting and formatting
- [golangci-lint](https://golangci-lint.run/) for Go linting
- [expo-doctor](https://docs.expo.dev/) for Expo/React Native project health

## Contributors

Thanks to everyone who has shipped code, ideas, docs, or bug reports.

<!-- CONTRIBUTORS-START -->
- [@heavykenny](https://github.com/heavykenny)
- [@yashrajoria](https://github.com/yashrajoria)
<!-- CONTRIBUTORS-END -->

This list is regenerated by `.github/workflows/contributors.yml` after every push to `develop` or `main`. The workflow reads git log, resolves each author's GitHub login, and opens a PR with any diff. If your commits aren't being credited, either link your commit email under [GitHub Settings → Emails](https://github.com/settings/emails) or add a mapping to [`.github/contributors-overrides.json`](.github/contributors-overrides.json).

## License

[MIT](LICENSE)

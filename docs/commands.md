# Commands

Use `aislop --help` for the short overview, `aislop commands` for the full public command list, and `aislop <command> --help` for command-specific help.

For one-off latest runs without installing, prefix commands with `npx aislop@latest`, for example:

```bash
npx aislop@latest scan
```

## Overview

| Command | What it does |
|---|---|
| `aislop` | Interactive TTY menu, or scan current directory in non-TTY shells |
| `aislop scan [directory]` | Score code quality and show findings |
| `aislop fix [directory]` | Apply auto-fixes or hand remaining findings to an agent |
| `aislop ci [directory]` | Run the CI quality gate with thresholded exit codes |
| `aislop init [directory]` | Create `.aislop/config.yml`, `.aislop/rules.yml`, and optional workflow |
| `aislop doctor [directory]` | Check installed engines and project coverage |
| `aislop rules [directory]` | Explain rule IDs, severity, fixability, and meaning |
| `aislop hook install [agents...]` | Install coding-agent hooks |
| `aislop hook uninstall [agents...]` | Remove coding-agent hooks |
| `aislop hook status` | Show installed hook status |
| `aislop hook baseline` | Capture the current score as the hook baseline |
| `aislop install [agents...]` | Alias for `aislop hook install` |
| `aislop uninstall [agents...]` | Alias for `aislop hook uninstall` |
| `aislop badge [directory]` | Print score badge URL and README markdown |
| `aislop trend [directory]` | Show recent scores from `.aislop/history.jsonl` |
| `aislop update` | Show current and latest npm versions |
| `aislop upgrade` | Alias for `aislop update` |
| `aislop version` | Print the installed version |
| `aislop commands` | Show the full command reference |

`aislop hooks` is an alias for `aislop hook`. `aislop install hooks ...` and `aislop uninstall hooks ...` are accepted natural aliases for hook install and uninstall.

## Flags

### scan

| Flag | Description |
|---|---|
| `--changes` | Only scan changed files (defaults to diffing `HEAD`) |
| `--base <ref>` | Diff base for `--changes`, e.g. `origin/main` (default `HEAD`) |
| `--staged` | Only scan staged files |
| `-d, --verbose` | Show detailed per-file output |
| `--json` | Output JSON instead of terminal UI |
| `--sarif` | Output SARIF 2.1.0 |
| `--format <format>` | Output format: `json` or `sarif` |
| `--include <patterns>` | Only scan matching comma-separated or repeated paths |
| `--exclude <patterns>` | Exclude comma-separated or repeated paths |

### ci

| Flag | Description |
|---|---|
| `--changes` | Only gate changed files (defaults to diffing `HEAD`) |
| `--base <ref>` | Diff base for `--changes`, e.g. `origin/main` (default `HEAD`) |
| `--staged` | Only gate staged files |
| `--human` | Render the human-friendly scan UI instead of JSON |
| `--sarif` | Output SARIF 2.1.0 |
| `--format <format>` | Output format: `json` or `sarif` |

Use `--changes --base origin/<target>` to gate a pull request on only the files it touches. See [CI / CD](ci.md) for per-provider recipes (GitHub Actions, GitLab, CircleCI, Bitbucket Pipelines).

### fix

| Flag | Description |
|---|---|
| `-d, --verbose` | Show detailed fix progress |
| `-f, --force` | Run aggressive fixes: dependency audit, framework alignment, unused file removal |
| `--safe` | Only apply reversible fixes |
| `-p, --prompt` | Print an agent-ready prompt for remaining issues |

Agent handoff flags: `--claude`, `--codex`, `--cursor`, `--windsurf`, `--vscode`, `--amp`, `--antigravity`, `--deep-agents`, `--gemini`, `--kimi`, `--opencode`, `--warp`, `--aider`, `--goose`, `--pi`, `--crush`.

### hook install

| Flag | Description |
|---|---|
| `--agent <names>` | Comma-separated agent list |
| `-g, --global` | Install to user-scope config |
| `--project` | Install to project-scope config |
| `--dry-run` | Print the planned diff without writing |
| `--yes` | Skip confirmation prompt |
| `--quality-gate` | Add a Claude Stop hook that blocks score regressions |

Agent shortcut flags: `--claude`, `--cursor`, `--gemini`, `--pi`, `--codex`, `--windsurf`, `--cline`, `--kilocode`, `--antigravity`, `--copilot`.

### hook uninstall

| Flag | Description |
|---|---|
| `--agent <names>` | Comma-separated agent list |
| `-g, --global` | Uninstall from user-scope config |
| `--project` | Uninstall from project-scope config |
| `--dry-run` | Print the planned removal without writing |

Agent shortcut flags: `--claude`, `--cursor`, `--gemini`, `--pi`, `--codex`, `--windsurf`, `--cline`, `--kilocode`, `--antigravity`, `--copilot`.

### Other command flags

| Command | Flags |
|---|---|
| `aislop ci` | `--human`, `--sarif`, `--format <format>` |
| `aislop init` | `--strict` |
| `aislop rules` | `--search` |
| `aislop badge` | `--owner <owner>`, `--repo <repo>`, `--json` |
| `aislop trend` | `--limit <n>` |
| Global | `-h, --help`, `-v, --version`, `-V` |

## Ignore and Scope

`node_modules`, `.git`, `dist`, `build`, and `coverage` are excluded by default.

Add project-wide ignore rules in `.aislopignore`:

```gitignore
src/generated
**/*.snap
legacy
```

Use `--include` and `--exclude` for one run:

```bash
aislop scan --include "src/**"
aislop scan --exclude "dist,generated"
```

## Examples

```bash
# Scan
aislop scan
aislop scan ./src
aislop scan --changes
aislop scan --staged
aislop scan --json
aislop scan --sarif

# Fix
aislop fix
aislop fix --safe
aislop fix -f
aislop fix --claude
aislop fix -p

# Hooks
aislop hook install --claude
aislop hook install --agent claude,cursor
aislop hook install --claude --quality-gate
aislop hook baseline
aislop hook status
aislop hook uninstall --claude
aislop install claude cursor
aislop uninstall hooks --claude

# CI and reference
aislop ci
aislop ci --sarif
aislop rules --search
aislop badge --owner scanaislop --repo aislop
aislop trend --limit 20
aislop update
aislop version
aislop commands
```

## Fix Workflow

The recommended workflow for getting a project to 100/100:

```text
scan          See all issues
  |
fix --safe    Apply only reversible fixes
  |
fix           Auto-fix formatting, lint, imports, comments
  |
fix -f        Aggressive fixes: dependency audit, unused file removal
  |
fix --claude  Hand off remaining issues to a coding agent
  |
scan          Verify everything is resolved
```

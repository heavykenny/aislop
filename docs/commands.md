# Commands

## Overview

| Command | What it does |
|---|---|
| `aislop` | Interactive TTY menu (falls back to `scan` in non-TTY) |
| `aislop scan [dir]` | Run all enabled engines and print a scored report |
| `aislop fix [dir]` | Apply safe auto-fixes (imports, lint, formatting, deps) |
| `aislop ci [dir]` | Output JSON for CI pipelines |
| `aislop init [dir]` | Create `.aislop/config.yml` and `.aislop/rules.yml` |
| `aislop doctor [dir]` | Report which tools are installed and available |
| `aislop rules [dir]` | List all built-in and configured rules |

## Flags

### scan

| Flag | Description |
|---|---|
| `--changes` | Only scan files changed from `HEAD` |
| `--staged` | Only scan staged files |
| `-d, --verbose` | Show detailed per-file output |
| `--json` | Output JSON instead of terminal UI |

### fix

| Flag | Description |
|---|---|
| `-f, --force` | Run aggressive fixes (dependency audit, unused file removal, unsafe lint rewrites) |
| `-p, --prompt` | Print an agent-ready prompt for remaining issues (pipe-friendly) |

#### Agent flags — CLI agents (launch with prompt directly)

| Flag | Agent |
|---|---|
| `--claude` | Claude Code |
| `--codex` | Codex |
| `--amp` | Amp |
| `--antigravity` | Antigravity |
| `--deep-agents` | Deep Agents |
| `--gemini` | Gemini CLI |
| `--kimi` | Kimi Code CLI |
| `--opencode` | OpenCode |
| `--warp` | Warp |
| `--aider` | Aider |
| `--goose` | Goose |

#### Agent flags — Editor agents (open editor + copy prompt to clipboard)

| Flag | Editor |
|---|---|
| `--cursor` | Cursor |
| `--windsurf` | Windsurf |
| `--vscode` | VS Code |

### global

| Flag | Description |
|---|---|
| `-d, --verbose` | Show detailed output |
| `-v, --version` | Print version |

## Examples

```bash
# Scan the current directory
aislop scan

# Scan a specific directory
aislop scan ./src

# Scan only changed files (great for pre-commit)
aislop scan --changes

# Scan only staged files
aislop scan --staged

# Auto-fix what can be fixed
aislop fix

# Aggressive fix mode (audit, unused files, unsafe lint)
aislop fix -f

# Fix then hand off remaining issues to Claude Code
aislop fix --claude

# Fix aggressively, then hand off the rest to Claude
aislop fix -f --claude

# Open Cursor with prompt copied to clipboard
aislop fix --cursor

# Print a prompt to paste into any coding agent
aislop fix -p

# CI-friendly JSON output
aislop ci

# Initialize config files in current directory
aislop init

# Check what tools are available
aislop doctor

# List all rules
aislop rules
```

## Fix workflow

The recommended workflow for getting a project to 100/100:

```
scan          See all issues
  ↓
fix           Auto-fix formatting, lint, imports, comments
  ↓
fix -f        Aggressive fixes: dependency audit, unused file removal
  ↓
fix --claude  Hand off remaining issues to a coding agent
  ↓
scan          Verify everything is resolved
```

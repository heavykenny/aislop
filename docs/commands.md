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

| Flag | Description |
|---|---|
| `--changes` | Only scan files changed from `HEAD` |
| `--staged` | Only scan staged files |
| `-d, --verbose` | Show detailed per-file output |
| `--json` | Output JSON instead of terminal UI |
| `-f, --force` | For `fix`: run aggressive fixes (audit + Expo dependency alignment) |
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

# Aggressive fix mode (may change dependency graph)
aislop fix --force

# CI-friendly JSON output
aislop ci

# Initialize config files in current directory
aislop init

# Check what tools are available
aislop doctor

# List all rules
aislop rules
```

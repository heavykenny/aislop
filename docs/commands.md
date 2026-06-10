# Commands

Use `aislop --help` for the short overview, `aislop commands` for the full public command list, and `aislop <command> --help` for command-specific help.

For one-off latest runs without installing, prefix commands with `npx aislop@latest`, for example:

```bash
npx aislop@latest scan
```

## Overview

| Command | What it does |
|---|---|
| `aislop [directory]` | Interactive TTY menu, or scan current directory in non-TTY shells |
| `aislop scan [directory]` | Score code quality and show findings |
| `aislop agent [directory]` | Run a local worktree repair session with Codex, Claude Code, or OpenCode |
| `aislop fix [directory]` | Apply deterministic auto-fixes, or hand remaining findings to an agent |
| `aislop agent plan [directory]` | Preview provider, worktree, findings, and publish actions |
| `aislop agent providers` | Show installed local provider status and setup hints |
| `aislop agent connect [provider]` | Run a provider's local CLI login flow |
| `aislop agent use [provider]` | Set or show the repo-local default repair provider |
| `aislop agent switch [provider]` | Alias for `aislop agent use` |
| `aislop agent monitor [directory]` | Watch git changes and stream scan or repair cycles |
| `aislop agent monitor list [directory]` | List local background agent monitors |
| `aislop agent monitor show [monitor]` | Show a background monitor record |
| `aislop agent monitor stop [monitor]` | Stop a running background monitor |
| `aislop agent sessions [directory]` | List recent local agent sessions |
| `aislop agent show [session]` | Show a session summary and timeline |
| `aislop agent apply [session]` | Apply a reviewed isolated worktree session back to the repo |
| `aislop agent watch [session]` | Stream a local session transcript |
| `aislop agent stop [session]` | Stop a running background session |
| `aislop ci [directory]` | Run the CI quality gate with thresholded exit codes |
| `aislop init [directory]` | Create `.aislop/config.yml`, `.aislop/rules.yml`, and optional workflow |
| `aislop doctor [directory]` | Check installed engines and project coverage |
| `aislop rules [directory]` | Explain rule IDs, severity, fixability, score impact, and meaning |
| `aislop hook` | Manage per-edit coding-agent hooks |
| `aislop hook install [agents...]` | Install coding-agent hooks |
| `aislop hook uninstall [agents...]` | Remove coding-agent hooks |
| `aislop hooks` | Alias for `aislop hook` |
| `aislop hook status` | Show installed hook status |
| `aislop hook baseline` | Capture the current score as the hook baseline |
| `aislop install [agents...]` | Alias for `aislop hook install` |
| `aislop install hooks [agents...]` | Natural alias for `aislop hook install` |
| `aislop uninstall [agents...]` | Alias for `aislop hook uninstall` |
| `aislop uninstall hooks [agents...]` | Natural alias for `aislop hook uninstall` |
| `aislop badge [directory]` | Print score badge URL and README markdown |
| `aislop trend [directory]` | Show recent scores from `.aislop/history.jsonl` |
| `aislop trends [directory]` | Alias for `aislop trend` |
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

### agent

`aislop agent` is the local-first repair loop. It creates an isolated git worktree by default, runs safe deterministic fixes, streams a headless provider session, verifies with `aislop scan --json`, writes a JSONL session transcript, and leaves the worktree for review unless you apply or publish the diff.

Provider auth stays with the provider CLI you already use:

```bash
aislop agent providers          # inspect local provider status
aislop agent connect codex      # runs codex login
aislop agent connect claude     # runs claude auth login
aislop agent connect opencode   # runs opencode auth login
aislop agent use claude         # save a repo-local default provider
aislop agent use auto           # clear the saved default and auto-detect
aislop agent plan               # preview the local run without editing
aislop agent monitor            # stream scans when git changes settle
aislop agent monitor --background
aislop agent monitor list       # list background monitors
aislop agent monitor show       # inspect latest monitor record
aislop agent monitor stop       # stop latest background monitor
aislop agent monitor --repair --in-place
aislop agent --provider claude  # switch repair provider for this run
aislop agent sessions           # list local transcripts
aislop agent show               # show the latest timeline and summary
aislop agent apply              # apply a reviewed worktree session later
aislop agent watch              # stream transcript updates
aislop agent stop               # stop a running background session
```

| Flag | Description |
|---|---|
| `--provider <provider>` | Provider to use: `auto`, `codex`, `claude`, or `opencode` |
| `--target-score <score>` | Score to converge toward |
| `--max-turns <n>` | Maximum provider turns for one repair attempt |
| `--limit <n>` | Maximum findings to hand to the provider |
| `--in-place` | Edit the current worktree instead of creating an isolated worktree |
| `--apply` | Apply the accepted diff back to the original worktree |
| `-y, --yes` | Skip confirmation prompts for `--apply` |
| `--dry-run` | Print the selected provider and plan without running it |
| `--background` | Start the local agent session in a detached background process |
| `--no-fix` | Skip deterministic safe fixes before provider handoff |
| `--commit` | Commit the verified diff on an agent branch |
| `--pr` | Push the agent branch and open a draft pull request |
| `--branch <name>` | Branch name for `--commit` or `--pr` |
| `--base <branch>` | Base branch for `--pr` |
| `--commit-message <message>` | Commit message for `--commit` or `--pr` |
| `--title <title>` | Pull request title for `--pr` |
| `--ready` | Open a ready-for-review PR instead of a draft |
| `--no-keep-worktree` | Remove the generated worktree when it is safe to do so |
| `--cleanup` | Remove the generated worktree even when a diff remains |

Use `aislop agent use <provider>` to save a repo-local default provider under `.aislop/agent/provider.json`; this file is added to the local Git exclude and is not a tracked project config. `--provider <provider>` still overrides the saved default for one run, and `--provider auto` forces auto-detection.

Use `aislop agent plan` with the same flags before running the agent to preview the selected provider, provider source, git worktree mode, current score, findings handed to the provider, apply behavior, commit message, and PR mode. It also reports blockers such as an unauthenticated provider, dirty checkout in isolated worktree mode, or `--background --apply` without `--yes`.

Session transcripts are stored under `.aislop/agent/sessions/`. Agent sessions and worktrees are added to the repo's local `.git/info/exclude`, so local agent state stays out of commits without editing project `.gitignore`. Provider JSONL is normalized for the terminal stream while raw output remains in the transcript for audit.

Background runs return immediately with a session id, transcript path, and log path. Use `aislop agent show <session>` to inspect progress. `--apply --background` requires `--yes` because a detached run cannot prompt.

For isolated worktree sessions, use `aislop agent apply <session>` after review to apply the verified diff back to the original repo. Add `--dry-run` to preview the files first, or `--yes` to skip the confirmation prompt.

Monitor mode:

| Command | Description |
|---|---|
| `aislop agent monitor [directory] --once` | Run one local monitor scan cycle and exit |
| `aislop agent monitor [directory] --interval <ms> --debounce <ms>` | Poll git status and react after changes settle |
| `aislop agent monitor [directory] --repair --in-place` | Run bounded local repair sessions when scans miss the target |
| `aislop agent monitor [directory] --background` | Start a detached local monitor and return the monitor id, record path, and log path |
| `aislop agent monitor list [directory] --limit <n>` | List recent background monitor records with latest score summary |
| `aislop agent monitor show [monitor] --root <directory>` | Show one background monitor's status, log path, and recent scan cycles |
| `aislop agent monitor stop [monitor] --root <directory> --force` | Stop a background monitor, using `SIGKILL` with `--force` |

By default, monitor mode scans and reports only. Automatic edits require both `--repair` and `--in-place`, because the monitor reacts to the checkout the developer is actively editing. Background monitor records keep a compact recent cycle history: timestamp, score, finding count, changed files, and whether a repair session was triggered.

Session review commands:

| Command | Description |
|---|---|
| `aislop agent use [provider] --root <directory> --dry-run` | Set, clear, or show the repo-local default repair provider |
| `aislop agent sessions [directory] --limit <n>` | List recent local sessions |
| `aislop agent show [session] --root <directory>` | Show one session's review summary, timeline, selected findings, changed files, and recent provider output |
| `aislop agent apply [session] --root <directory> --dry-run` | Preview or apply a reviewed isolated worktree diff back to the repo |
| `aislop agent watch [session] --root <directory> --interval <ms>` | Follow a session transcript until completion and print the terminal review summary |
| `aislop agent stop [session] --root <directory> --force` | Stop a running background session, using `SIGKILL` with `--force` |

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
| `aislop ci` | `--changes`, `--staged`, `--base <ref>`, `--human`, `--sarif`, `--format <format>` |
| `aislop init` | `--strict` |
| `aislop rules` | `--search` |
| `aislop badge` | `--owner <owner>`, `--repo <repo>`, `--json` |
| `aislop trend` | `--limit <n>` |
| `aislop trends` | `--limit <n>` |
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

# Local agent repair
aislop agent
aislop agent providers
aislop agent connect codex
aislop agent use codex
aislop agent plan
aislop agent monitor --once
aislop agent monitor --background
aislop agent monitor list
aislop agent --provider codex
aislop agent --background
aislop agent --provider claude --apply
aislop agent --provider codex --pr
aislop agent sessions
aislop agent show
aislop agent apply
aislop agent watch
aislop agent stop

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
aislop trends --limit 10
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

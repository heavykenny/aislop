# aislop

**Stop AI slop from shipping.**

[![npm version](https://img.shields.io/npm/v/aislop.svg)](https://www.npmjs.com/package/aislop)
[![npm downloads](https://img.shields.io/npm/dm/aislop.svg)](https://www.npmjs.com/package/aislop)
[![CI](https://github.com/heavykenny/aislop/actions/workflows/ci.yml/badge.svg)](https://github.com/heavykenny/aislop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

`aislop` is a unified code-quality CLI that catches the lazy patterns AI coding tools leave behind. One command, one score out of 100.

```
$ npx aislop scan

aislop Scan v0.2.0

  ✓ Project my-app (typescript)
  Source files: 142

  ✓ Formatting:      done (0 issues)
  ✓ Linting:         done (2 warnings)
  ✓ Code Quality:    done (1 warning)
  ! Maintainability:  done (4 warnings)
  ✓ Security:        done (0 issues)

  Score: 80/100 (Healthy)
```

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
aislop fix                 # auto-fix formatting + lint issues
```

### Use in CI pipelines

```bash
aislop ci                  # JSON output, exits 1 if score < threshold
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

## Why aislop?

AI-generated code passes review because issues are spread across dozens of files. No single linter catches all of them. `aislop` does:

- **AI-specific pattern detection** — trivial comments, thin wrappers, generic names, swallowed exceptions, `as any` casts
- **Multi-language** — TypeScript, JavaScript, Python, Go, Rust, Ruby, PHP, Expo/React Native
- **Single score** — one number to gate PRs, track in CI, and trend over time
- **Zero config** — run `npx aislop scan` and get results immediately
- **Framework-aware** — auto-detects Next.js, React, Expo, Vite, Remix, Django, Flask, FastAPI
- **Batteries included** — ships with oxlint, biome, knip; downloads ruff and golangci-lint on install

## What it catches

Six engines run in parallel: **Formatting**, **Linting**, **Code Quality**, **AI Slop Detection**, **Security**, and **Architecture** (opt-in).

| Engine | Examples |
|---|---|
| Formatting | Biome, ruff, gofmt, cargo fmt, rubocop, php-cs-fixer |
| Linting | oxlint, ruff, golangci-lint, clippy, expo-doctor |
| Code Quality | Function/file size limits, deep nesting, duplication, dead code, unused dependencies (knip) |
| AI Slop | Trivial comments, swallowed exceptions, unused imports, console leftovers, type assertion abuse, TODO stubs |
| Security | Hardcoded secrets, eval, innerHTML, SQL/shell injection, dependency audits |
| Architecture | Custom import bans, layering rules, required patterns |

See the full [rules reference](docs/rules.md) for all 30+ built-in rules.

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

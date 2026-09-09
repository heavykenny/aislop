# Installation

The same CLI is published to npm, Homebrew, and PyPI. Pick whichever fits your stack — every channel installs the identical `aislop` and `aislop-mcp` commands.

| Channel | Command | Notes |
|---|---|---|
| npm / npx | `npx aislop@latest scan` | No install; optional native tools are described below |
| Homebrew | `brew install scanaislop/tap/aislop` | macOS / Linux; pulls Node as a dependency |
| Python / pipx | `pipx install aislop` | Isolated env; needs Node on `PATH` |

## Run without installing

```bash
npx aislop scan
```

## Install as a dev dependency

```bash
# npm
npm install --save-dev aislop

# yarn
yarn add --dev aislop

# pnpm
pnpm add -D aislop
```

## Global install

```bash
npm install -g aislop
aislop scan
```

## Install from GitHub Packages

The package is also published as `@scanaislop/aislop` on GitHub Packages:

```bash
npm install --save-dev @scanaislop/aislop --registry=https://npm.pkg.github.com
```

## Install with Homebrew

macOS and Linux, via the official tap:

```bash
brew install scanaislop/tap/aislop
```

Equivalent two-step form:

```bash
brew tap scanaislop/tap
brew install aislop
```

Homebrew installs Node.js as a runtime dependency if it isn't already present. Upgrade with `brew upgrade aislop`. More: [homebrew-tap](https://github.com/scanaislop/homebrew-tap).

## Install with pipx (Python)

For Python-tooling environments:

```bash
pipx install aislop
```

`pipx` keeps `aislop` in an isolated virtual environment. Plain `pip install --user aislop` also works. Both still require **Node.js** on `PATH`, since the engines run on Node. Upgrade with `pipx upgrade aislop`. More: [PyPI package](https://pypi.org/project/aislop/).

## Bundled tooling

`aislop` ships with its Node-based tooling (oxlint, biome, knip) as package dependencies. Installing the package does not run dependency lifecycle scripts, so the core scanner works with npm v12's secure install defaults.

For bundled **ruff** and **golangci-lint** coverage, run the explicit tool installer once after installing `aislop`:

```bash
aislop-tools
```

For a one-off npx installation:

```bash
npx --yes --package=aislop@latest aislop-tools
```

The command exits non-zero if a supported binary cannot be installed. Run `aislop doctor` afterwards to verify the tools available to each engine.

## External tools

Some checks depend on tools already installed on your machine:

- `gofmt`, `govulncheck` (Go)
- `cargo`, `clippy` (Rust)
- `rubocop` (Ruby)
- `phpcs`, `php-cs-fixer` (PHP)
- `.NET SDK`, `roslynator`, `jb` (C#)
- `cppcheck`, `clang-format`, `clang-tidy` (C/C++)

C# projects receive built-in text and complexity checks without optional lint tools. For project-aware formatting and dependency checks, install the .NET SDK and opt in for repositories you trust:

```yaml
lint:
  csharp:
    projectEvaluation: true
```

See the [rules reference](rules.md#c-linting-hybrid-jb--roslynator) for the optional lint setup.

C/C++ tools are system installs that aislop shells out to - they are not bundled. Install them with your system package manager:

```bash
# macOS
brew install cppcheck llvm

# Debian / Ubuntu
sudo apt install cppcheck clang-format clang-tidy

# Windows (scoop)
scoop install cppcheck llvm
```

Notes:
- `cppcheck` runs on any C/C++ checkout
- `clang-format` runs only when the repo ships a `.clang-format` file
- `clang-tidy` runs only when a `compile_commands.json` is present. aislop discovers it in common generated layouts such as `build/`, `build/<Configuration>/`, `out/`, and `cmake-build-*` (including one or more nested subdirectories under those paths).

If your project writes the database outside the repo root, keep that path stable:

```bash
cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
cmake --build build
```

Run `aislop doctor` to see what is available on your system.

## Requirements

- **Node.js** >= 20

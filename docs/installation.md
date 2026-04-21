# Installation

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

## Bundled tooling

`aislop` ships with Node-based tooling (oxlint, biome, knip) as package dependencies. On install it also downloads bundled binaries for **ruff** and **golangci-lint**.

To skip binary downloads:

```bash
AISLOP_SKIP_TOOL_DOWNLOAD=1 npm install
```

## External tools

Some checks depend on tools already installed on your machine:

- `gofmt`, `govulncheck` (Go)
- `cargo`, `clippy` (Rust)
- `rubocop` (Ruby)
- `phpcs`, `php-cs-fixer` (PHP)

Run `aislop doctor` to see what is available on your system.

## Requirements

- **Node.js** >= 20

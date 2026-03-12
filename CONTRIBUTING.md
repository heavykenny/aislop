# Contributing to aislop

Thanks for your interest in making `aislop` better. This document covers everything you need to get started.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

---

## Getting started

### Prerequisites

- **Node.js** >= 20
- **pnpm** >= 10

### Setup

```bash
git clone https://github.com/heavykenny/aislop.git
cd aislop
pnpm install
```

### Common commands

```bash
pnpm build        # Build with tsdown
pnpm typecheck    # Run tsc --noEmit
pnpm test         # Build + run vitest
pnpm vitest run   # Run tests without rebuilding
pnpm scan         # Build + run aislop on itself
```

### Running aislop locally

After building you can run it directly:

```bash
node dist/cli.js scan .
node dist/cli.js scan /path/to/other/project
```

Or use `pnpm exec`:

```bash
pnpm exec aislop scan .
```

---

## Project structure

```
src/
  cli.ts                    # CLI entry point (commander)
  index.ts                  # Public API exports

  commands/                 # CLI subcommands
    scan.ts                 #   Full scan
    fix.ts                  #   Auto-fix
    init.ts                 #   Config initialization
    doctor.ts               #   Tool availability check
    rules.ts                #   Rule listing
    ci.ts                   #   CI output
    interactive.ts          #   TTY menu

  config/                   # Configuration loading and validation
    index.ts                #   File discovery and loading
    schema.ts               #   Zod v4 schema
    defaults.ts             #   Default values and YAML templates

  engines/                  # Detection engines
    types.ts                #   Core types (Diagnostic, Engine, EngineContext)
    orchestrator.ts         #   Parallel engine runner

    format/                 #   Formatting checks (biome, ruff, gofmt, etc.)
    lint/                   #   Linting checks (oxlint, ruff, golangci, etc.)
    code-quality/           #   Complexity, duplication, dead code (knip)
    ai-slop/                #   AI pattern detection
    architecture/           #   Import and path rules
    security/               #   Secrets, risky constructs, dependency audits

  scoring/                  #   Score calculation (0-100)
  output/                   #   Terminal rendering, JSON output
  utils/                    #   Discovery, git, subprocess, tooling

tests/                      # Vitest test suite
scripts/                    # Postinstall tool downloads
.aislop/                    # aislop's own configuration
```

---

## How to contribute

### Reporting bugs

Open a [bug report](https://github.com/heavykenny/aislop/issues/new?template=bug_report.yml). Include:

- What you ran
- What happened vs. what you expected
- `aislop` version (`aislop --version`)
- Node version, OS, package manager

### Suggesting features

Open a [feature request](https://github.com/heavykenny/aislop/issues/new?template=feature_request.yml). Describe the problem it solves and give an example of the pattern you want detected.

### Submitting a pull request

1. Fork the repo and create a branch from `develop`
2. Make your changes
3. Add or update tests for any new behavior
4. Run the full check:
   ```bash
   pnpm typecheck && pnpm test && pnpm scan
   ```
5. Open a PR to `develop` with a clear description of what changed and why

> **AI assistants**: see [AGENTS.md](AGENTS.md) for build commands, architecture notes, and self-detection avoidance rules.

---

## Adding a new AI slop rule

This is the most common type of contribution. Here's how:

### 1. Pick the right file

AI slop detectors live in `src/engines/ai-slop/`:

| File | Responsibility |
| --- | --- |
| `comments.ts` | Comment quality (trivial, section dividers) |
| `dead-patterns.ts` | Console leftovers, TODO stubs, dead code, type assertions |
| `unused-imports.ts` | Unused import detection |
| `exceptions.ts` | Swallowed exceptions |
| `abstractions.ts` | Thin wrappers, generic naming |

If your rule doesn't fit any of these, create a new file and wire it into `src/engines/ai-slop/index.ts`.

### 2. Write the detector

A detector is a function that takes file content and returns `Diagnostic[]`:

```typescript
const detectMyPattern = (
  content: string,
  relativePath: string,
  ext: string,
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    if (/* your pattern matches */) {
      diagnostics.push({
        filePath: relativePath,
        engine: "ai-slop",
        rule: "ai-slop/my-rule-name",
        severity: "warning",       // "error" | "warning" | "info"
        message: "Clear description of the problem",
        help: "Actionable suggestion to fix it",
        line: i + 1,
        column: 0,
        category: "AI Slop",
        fixable: false,
      });
    }
  }

  return diagnostics;
};
```

### 3. Avoid self-detection

Since `aislop` scans itself, your detector's source code might contain the exact patterns it detects. Use string concatenation to build regex patterns and messages:

```typescript
// Bad -- aislop will flag its own source
const pattern = /as any/;

// Good -- breaks the literal so it won't self-match
const pattern = new RegExp(`${"a" + "s"}\\s+${"an" + "y"}`);
```

### 4. Register the rule name

Add your rule to the `BUILTIN_RULES` array in `src/commands/rules.ts` so it appears in `aislop rules`.

### 5. Write tests

Add tests in `tests/`. Every detector test follows the same pattern:

```typescript
it("detects the problem", async () => {
  const filePath = writeFile("test.ts", `problematic code here`);
  const diagnostics = await detectMyFunction(makeContext([filePath]));
  const results = diagnostics.filter((d) => d.rule === "ai-slop/my-rule-name");
  expect(results.length).toBe(1);
});

it("does not flag clean code", async () => {
  const filePath = writeFile("clean.ts", `clean code here`);
  const diagnostics = await detectMyFunction(makeContext([filePath]));
  const results = diagnostics.filter((d) => d.rule === "ai-slop/my-rule-name");
  expect(results).toHaveLength(0);
});
```

### 6. Validate

```bash
pnpm typecheck
pnpm vitest run
pnpm build && node dist/cli.js scan .
```

---

## Adding support for a new language

Language support involves several layers:

1. **Discovery** -- add detection in `src/utils/discover.ts`
2. **Source files** -- ensure the file extension is included in `src/utils/source-files.ts`
3. **Engine integrations** -- add the formatter/linter calls in the relevant engine directories
4. **Tests** -- add fixture files and test cases

---

## Style guide

- TypeScript strict mode
- Tabs for indentation (biome default)
- No unused imports or variables
- Run `aislop` on your changes -- it should score Healthy

---

## Releases

Releases are automated. When a maintainer creates a GitHub Release (or pushes a `v*` tag), CI builds and publishes to npm using OIDC trusted publishing -- no long-lived tokens required. See `.github/workflows/release.yml`.

Version bumps follow [semver](https://semver.org/):

- **patch** -- bug fixes, false-positive fixes
- **minor** -- new rules, new language support, new features
- **major** -- breaking config changes, removed rules

---

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).

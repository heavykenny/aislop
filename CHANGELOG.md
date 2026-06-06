# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.11.0 (2026-06-06)

PR-scoped quality gates and set-and-forget CI. `scan` and `ci` can now gate a pull request on only the files it changed (`--changes --base <ref>`), and an explicit base ref that cannot be resolved fails the run instead of silently passing an empty scan. A moving `v1` Action tag plus `version: latest` mean workflows never need a version bump, and every CI example now standardizes on Node 24.

### Added

- **`--base <ref>` and `ci --changes`.** Both `scan` and `ci` now accept `--changes --base <ref>` to diff against a branch instead of `HEAD`, so a pull request can be gated on only the files it touches even when those files are already committed (a plain `--changes` diffs the working tree against `HEAD` and sees nothing in CI). `ci` also accepts `--changes` and `--staged` directly, applying the score gate and exit code to the scoped set. New Bitbucket Pipelines recipe in the docs uses `aislop ci --changes --base "origin/$BITBUCKET_PR_DESTINATION_BRANCH"`, removing the previous merge-base + soft-reset workaround ([#185](https://github.com/scanaislop/aislop/issues/185)).
- **`forceFixable` flag.** `scan --json` diagnostics now carry an explicit `forceFixable` boolean for findings that only `aislop fix -f` resolves (npm/pnpm dependency vulnerabilities, unused files/deps, Expo dependency alignment), so tools can surface a force-fix action without parsing help text ([#192](https://github.com/scanaislop/aislop/pull/192)).

### Changed

- **Set-and-forget CI.** A moving `v1` Action tag now tracks the latest release, so workflows can pin `uses: scanaislop/aislop@v1` instead of a per-release tag. `aislop init` generates a workflow using `@v1` with `version: latest`, and the CI docs lead with `npx --yes aislop@latest ci`. The release pipeline re-points `v1` automatically on each published release.
- **Node standardized on 24.** `.nvmrc`, the Action's default `node-version`, and every CI docs example now use Node 24. The supported runtime floor is unchanged (`engines: ">=20"`).
- **Marketplace Action renamed** to `aislop — AI Code Quality Gate`, published by `scanaislop`. Display metadata only; the action slug is unchanged.

## 0.10.2 (2026-06-02)

A patch release focused on safer release/CI plumbing and sharper scan consistency. The GitHub Action now keeps wrapper and npm CLI versions separate without letting exact npm pins be shadowed by a checked-out local package, `aislop init` emits reproducible pinned workflows, and the rule catalog/docs now stay aligned with the implemented detectors.

### Added

- **Suppression.** Silence a finding you have judged intentional with an inline directive: `// aislop-ignore-next-line [rule...]` (line below), `// aislop-ignore-line [rule...]` (same line), or `// aislop-ignore-file [rule...]` (whole file). Name one or more rules to scope it, or omit them to silence every rule on that line, and add a reason after `--`. Works in any comment syntax (`//`, `#`, `<!-- -->`). Directive lines are invisible to the comment engines, so they never join a comment block or get flagged themselves. Suppressed findings are dropped before scoring, and the run reports how many were silenced.
- **`.aislopignore`.** A root-level ignore file (same glob semantics as the `exclude` config, with `#` comments) to keep whole paths out of every scan.
- **`aislop fix --safe`.** An opt-in mode that restricts the run to fixes that cannot change behaviour — unused-import removal, import merging, narrative-comment removal, and formatting. Anything that deletes code or rewrites behaviour/attributes (console and dead-code removal, lint autofixes, unused-declaration and dependency pruning, and all `-f` force steps) is skipped, so a `--safe` run is genuinely safe to apply and commit. The default `fix` is unchanged.
- **Action smoke coverage.** The repository CI now exercises the composite GitHub Action in default `latest`, explicit `latest`, pinned npm-version, JSON, human, and node-version override modes.

### Changed

- **Coverage gate — no score off a sliver.** aislop now withholds the numeric score when it could only analyse a negligible fraction of a repo: when there are no files in a supported language, or when unsupported-language code (C, C++, C#, Swift, Kotlin, and similar) outnumbers supported files by more than three to one. Previously a repo like postgres (≈1.4M lines of C) could score 91 off two incidental Python helper scripts. The scan now prints a plain explanation instead of a number, `--json` returns `score: null` with `scoreable: false` and a `coverage` breakdown, and `ci` does not gate on a withheld score (but still fails on any error-severity diagnostic). The gate counts files through the same exclude patterns as the scan (`exclude` config and `.aislopignore`), so an intentionally ignored subtree never withholds the score for the code that was scanned.

### Fixed

- **No-downgrade guard on dependency fixes.** `aislop fix -f` no longer writes a dependency override that pins a package below the version already installed. Before applying npm/pnpm overrides it reads the installed version and drops any that would be a downgrade, reporting them as "skipped downgrade(s), verify intent" instead of silently regressing a dependency the way `npm audit fix --force` does.
- **CVE root-cause collapse.** The dependency audit now attributes a transitive vulnerability to the package that actually carries the advisory rather than emitting a near-duplicate finding for every intermediate package in the chain, so one root CVE reads as one issue instead of ten.
- **Python comma imports.** The unused-import fixer treated `import os, sys` as a single binding, so one unused module (`os`) deleted the whole line and broke the used one (`sys`). Each comma-separated module is now considered independently: the unused one is trimmed (`import os, sys` → `import sys`), the line is removed only when every module is unused, and a line where all are used is left alone.
- **Hook telemetry never sent.** The per-edit hook (`aislop hook <agent>`) emits its `hook_scan_completed` event with a fire-and-forget request, but the short-lived process called `process.exit()` before the request left the machine, so the event was always dropped (hook-install/status/etc. were unaffected since they flush via the command lifecycle). The hook now flushes telemetry before exiting, bounded to 1.5s so it never stalls the agent's edit.
- **GitHub Action exact-version pins.** Exact npm pins such as `version: "0.10.1"` now run from an isolated temp directory so npm cannot resolve the checked-out local package metadata instead of the published package.
- **Rule catalog consistency.** `aislop rules`, rule labels, and `docs/rules.md` now cover the implemented camel-case and newly-added rule IDs consistently, including `knip/devDependencies`, duplicate exports, dependency-audit skips, and React `dangerouslySetInnerHTML`.
- **Empty function detection.** `ai-slop/empty-function` now recognises normal JavaScript/TypeScript function declarations with parameter lists instead of only arrow stubs or malformed function headers.

### Tests

Full suite at 1029 passing, plus self-scan at 100 with zero diagnostics. New coverage locks the action manifest/workflow behavior, empty-function detection, shell-injection interpolation, and rule catalog label/doc parity.

## 0.10.1 (2026-05-30)

An accuracy release across Python and TypeScript, plus a small quality-of-life feature. The Python function detector was only seeing single-line synchronous `def`s, so async functions and wrapped multi-line signatures (about 58% of a large library like python-telegram-bot) were invisible to the complexity rules. In TypeScript, text-pattern rules were matching code inside JSDoc `@example` blocks as if it were live source. Both are fixed, and the complexity metrics were sharpened to measure real complexity rather than documentation or optional API surface.

### Added

- **Update notice.** The CLI prints a one-line "update available" notice when a newer version exists. It is cache-backed so it never blocks a run, and silent in CI, in non-interactive output, and when opted out via `AISLOP_NO_UPDATE_NOTIFIER`, `NO_UPDATE_NOTIFIER`, or `DO_NOT_TRACK`.

### Fixed

- **Python function detection** now recognises `async def` and multi-line wrapped signatures (where `):` sits on its own line). Previously these functions were skipped entirely by the code-quality engine.
- **JSDoc/TSDoc comment bleed.** Text-pattern rules no longer scan code inside `/** @example */` blocks, the largest false-positive source on documented TS/JS libraries. This covers `duplicate-import`, `console-leftover`, `empty-function`, `generic-naming`, `thin-wrapper`, `hardcoded-url` / `hardcoded-id`, and `security/hardcoded-secret`. On type-fest, `duplicate-import` dropped from 143 to 0; an error-severity `hardcoded-secret` on a password inside a Hono doc example is gone; genuine findings such as zod's real `as any` are preserved.
- **`ai-slop/duplicate-import`** no longer flags a namespace import (`import * as x`) alongside a named import from the same module. The two cannot be merged into one statement, so they were never a real duplicate.

### Changed

- **`complexity/function-too-long`** measures a Python function by its logical body (code statements only), excluding the signature, docstrings, comments, and blank lines. A heavily documented function is not a long one, so a function is judged by what it does, not how well it is described.
- **`complexity/too-many-params`** counts required parameters only, ignoring `self`/`cls`, `*args`/`**kwargs`, the `*` / `/` separators, and any parameter with a default. An API wrapper with many optional keyword arguments is idiomatic, not a smell.

### Tests

Full suite at 975 passing. New coverage for async detection, wrapped signatures, required-only parameter counting, docstring-aware length, comment masking, the `@example` import and secret cases, and the update notifier, plus a regression net: a realistic Python corpus with golden per-rule assertions and a detection-invariant check (functions detected vs `def`/`async def` count) that fails on the pre-0.10.1 detector.

## 0.10.0 (2026-05-30)

A precision release. A sweep through the ai-slop rules to cut false positives on real human-written code, validated against open-source libraries surfaced at the HN launch. One dropped from 426 findings to 92, every removed finding a false positive, with clean code still scoring 100. Plus a scoring change so genuine slop drives the number over house style.

### Fixed (false positives)

- **`ai-slop/thin-wrapper`** only flags a true passthrough (a function forwarding its own parameters unchanged); a call that transforms its arguments is real work, not a wrapper (#153).
- **`ai-slop/narrative-comment`** drops the bare-section-label branch, recognises reasoning markers ("ideally / however", "even though", "first need"), and the length-based branches now require an actual AI-narration signal rather than length alone, so long, well-written explanatory comments are kept (#153).
- **`ai-slop/unused-import`** no longer flags `from __future__ import` (a parser directive, not a usable name) (#153).
- **`ai-slop/trivial-comment`** only fires when the comment restates the next line; comments that add a condition or reason are kept (#153).
- **`ai-slop/silent-recovery`** only fires when the caught error is dropped, not when it is logged. Observable recovery is intentional, not a swallow (#153).
- **`ai-slop/meta-comment`** only flags leading plan markers, not UI "step N" wizard prose (#153).
- **`ai-slop/hardcoded-id` / `hardcoded-url`** exempt env-var-name literals, migration files, and stable vendor API hosts (`api.github.com` and friends) (#153).
- **`ai-slop/todo-stub`** spares TODOs that reference a tracking issue, which is documented debt, not an abandoned stub (#153).
- **`ai-slop/hallucinated-import`** parses PEP 735 `[dependency-groups]`, recognises `psycopg2` as provided by `psycopg2-binary`, and no longer flags import-shaped text inside docstrings, imports under `if TYPE_CHECKING:`, the `code`/`codeop`/`rlcompleter` stdlib modules, or non-production paths (validated on flask: 19 → 0) (#151, #153).
- **`docs/`** build tooling is treated as non-production, like `scripts/` and `examples/` (#153).

### Changed

- **Scoring:** style rules (comments, file size) weigh 0.5× so the score is driven by genuine slop rather than house style. The volume-based curve is unchanged (#153).

### Tests

Full suite at 945 passing.

## 0.9.6 (2026-05-30)

Precision fix for the `hardcoded-id` / `hardcoded-url` rules shipped in 0.9.5, which over-flagged on real codebases (surfaced by dogfooding the rules on our own dashboard).

### Fixed

- **`ai-slop/hardcoded-id` false positives.** No longer flags: env-var-name literals passed to config helpers (e.g. `optional("STRIPE_PRICE_ID", "")`), readable kebab/snake slugs and storage keys (rule keys, `STORAGE_KEY` values, CSS class strings), or identifiers inside DB migration files. The rule now requires an opaque, digit-bearing token, so genuine provider/project IDs (`price_1Oabc…`, AWS keys, OAuth client IDs) are still caught.
- **`ai-slop/hardcoded-url` false positives.** No longer flags `localhost` / loopback URLs (`http://localhost:…`, `127.0.0.1`, `0.0.0.0`), which are dev defaults rather than deployment configuration.
- **`ai-slop/hallucinated-import` on `psycopg2`.** The `psycopg2` import is now recognised as provided by `psycopg2-binary` (community-reported). Adds the missing alias.

### Tests

Full suite at 933 passing, including regression coverage for each false-positive class above.

## 0.9.5 (2026-05-30)

First release since the Hacker News launch. Fixes the Python import false positives reported there, adds two precision-first rules, ships the SARIF / per-rule-severity / `trend` tooling from #140, and extends agent support to pi (both the `fix` hand-off and an auto-running hook).

### Added

- **pi agent support (#144, #145).** `aislop fix --pi` hands off non-interactively (`pi -p "<prompt>"`), and `aislop hook install --pi` installs an auto-running pi extension that scans each edit and feeds the findings back to the model. `--crush` added alongside for `fix`.
- **`ai-slop/silent-recovery` (warning, #144).** Flags catch blocks that only log and then continue, swallowing the error.
- **`ai-slop/meta-comment` (warning, #144).** Flags AI plan/process narration comments (e.g. "Stage N of the...").
- **SARIF output (#140).** `aislop scan --sarif` for code-scanning integrations.
- **`trend` command (#140).** `aislop trend` tracks score over time from scan history.
- **Per-rule severity overrides + config JSON schema (#140).** Tune rule severities in config with editor autocompletion and validation.
- **Pre-commit hook integration (#140).**
- **Hardcoded-config and defensive-pattern rules (#139):** `ai-slop/hardcoded-id`, `ai-slop/hardcoded-url`, `ai-slop/redundant-try-catch`, `ai-slop/redundant-type-coercion`, `ai-slop/duplicate-type-declaration`.

### Fixed

- **Python import false positives (#144).** Install-name vs import-name divergences (`yaml`→pyyaml, `PIL`→pillow, `cv2`→opencv-python, and the rest) now resolve via an alias map, and packages declared only in `[project.optional-dependencies]` are recognised. Reported on HN.
- **TypeScript `@types` resolution (#144).** A type-only import backed solely by `@types/X` (including scoped `@scope/pkg` → `@types/scope__pkg`) no longer reports as undeclared.
- **`ai-slop/duplicate-import` on type imports (#144).** `import type {...}` alongside `import {...}` from the same module is no longer flagged as a duplicate; a genuine duplicate still is.
- **`security/eval` exec guard (#144).** Member/qualified calls like `foo.exec(...)` no longer match the bare `exec(` rule.
- **Trivial comments (#144).** Trivial single-line comments inside a contiguous `//` block are no longer counted.

### Changed

- **npm package description (#138)** aligned with the README and GitHub About.

### Tests

Full suite at 928 passing, including pi adapter/install coverage and the false-positive regression tests.

## 0.9.4 (2026-05-28)

Four new Python rules drawn from the verbosity signal in SlopCodeBench (SCBench, arXiv 2603.24755). Scan output now ends with a one-line nudge back to the GitHub repo. GitHub Discussions is open with structured templates for false-positive reports and rule requests.

### Added

- **`ai-slop/python-range-len-loop` (info, #134).** Flags `for i in range(len(items))` loops that usually want `enumerate(items)` or direct iteration. Hand-rolled index plumbing is a recurring agent shortcut; SCBench's Python track surfaces it as a verbosity contributor.
- **`ai-slop/python-chained-dict-get` (warning, #134).** Flags `.get(..., {}).get(...)` fallback chains. The empty-dict default hides missing-data cases and turns brittle as schemas evolve. Help text points to boundary normalization or typed objects.
- **`ai-slop/python-repetitive-dispatch` (warning, #134).** Flags ladders of 4+ `if x == "..." / elif x == "..."` branches sharing the same selector. Recommends a handler map / dispatch table. Threshold is configurable in code (`BRANCH_LADDER_THRESHOLD`).
- **`ai-slop/python-isinstance-ladder` (warning, #134).** Flags 4+ chained `isinstance(...)` branches on the same value. Recommends a handler map or normalized representation.
- **CLI star CTA (#132).** `aislop scan` ends with one muted line: `★ Found this useful? Star us at github.com/scanaislop/aislop`. Suppressed in JSON output, in `aislop ci`, and for any caller that passes `printBrand: false` (hook integrations).
- **GitHub Discussions surface (#126).** Discussions enabled on the repo with two issue-form templates: `false-positive.yml` (rule name, snippet, reasoning, version) and `rule-request.yml` (pattern, what should pass, suggested name, language). README links to Discussions and Issues from a new `## Community` section.

### Improved

- **README headline and lead description (#131).** Replaces enterprise-flavoured copy with a direct verb. The lead names the agents (Claude Code, Cursor, Codex, OpenCode) and the patterns they leave behind; the second paragraph names rule count, languages, determinism, and licence so the proof and the hook sit together at the top.

### Tests

35 new tests covering the four Python rules (positive and negative cases each). `tests/python-patterns.test.ts` now has 24 tests; full suite 842 passing.

## 0.9.3 (2026-05-22)

Patch release focused on rule precision. Tightens detection across the ai-slop, security, lint, and source-file engines so common language and ecosystem conventions are no longer flagged as slop. No new rules; existing rules now discriminate genuine documentation, intentional patterns, and build-time injections from the AI-written patterns they were designed to catch.

### Fixed

- **`ai-slop/narrative-comment` and `ai-slop/trivial-comment` no longer fire on language-idiomatic documentation (#121).** Recognizes JSDoc/Javadoc/PHPDoc descriptions above declarations, Ruby YARD/RDoc blocks (`@param`, `@return`, `:call-seq:`, `##` markers), Go struct-field docs (comment-word matches field name), and `// summary` / `# summary` lines directly above a Ruby/Java/PHP declaration. Extends the WHY-marker vocabulary (`to avoid`, `to ensure`, `in order to`, `for example`, `e.g.`, `useful for`, `intended to`, `by design`, …) and lets the escape hatch apply to line-kind blocks, not just JSDoc. Replaces the length-only catch-all with explicit AI-narration slop signals (`^This function/method/class`, `^It does/handles/...`, `^First/Then/Finally it`); the canonical AI-slop patterns still fire.
- **`ai-slop/hallucinated-import` understands Python project layouts and PEP 484 re-exports (#121).** Discovers local Python packages by scanning `<root>/`, `src/`, `lib/` for directories containing `__init__.py` — fixes large-scale false positives on projects whose internal packages (e.g. `_pytest`) were treated as missing dependencies. The PEP 484 re-export convention `from X import Y as Y` is no longer flagged as unused.
- **`security/eval` lookbehind skips method-call forms (#121).** `(?<![\w.>:\\])` prevents matches on `.eval(`, `->eval(`, `::eval(`, and `\eval(` (Predis Lua scripts, `binding.eval`, custom-class methods). Top-level `eval()` still fires.
- **`ai-slop/thin-wrapper` patterns ext-gated to JS/Python (#121).** The JS function-shape regex was accidentally matching PHP `public function valid(): bool { return isset(...); }` and Java methods. Patterns now apply only to `.ts/.tsx/.js/.jsx/.mjs/.cjs` (JS) and `.py` (Python).
- **`ai-slop/swallowed-exception` allows intentional-ignore convention (#121).** Catch parameters named `tolerated`, `ignored`, `expected`, `unused`, `_`, `_e`, `_err`, `_ex`, `_t` are recognized as documented intent. Same for Ruby `rescue ... => ignored`.
- **`ai-slop/rust-non-test-unwrap` skips doc-comment example blocks (#121).** Tracks `/*! ... */` and `/** ... */` ranges so `.unwrap()` inside crate-level doc examples (e.g. `regex/src/lib.rs`) is no longer flagged. Singular `xxx_test.rs` filenames are now recognized as test files alongside the existing `xxx_tests.rs`.
- **`security/dangerously-set-innerhtml` respects `aislop-ignore` / `biome-ignore` / `eslint-disable` comments and JSON-LD structured data (#121).** Two-line lookback for ignore directives, and skips `dangerouslySetInnerHTML` paired with `type="application/ld+json"` or `__html: JSON.stringify(...)` (safe by construction).
- **`code-quality/duplicate-block` no longer flags repeated import groups (#121).** Block hashing skips contiguous `import`/`from` lines so semantically identical import blocks across files don't surface as duplicates.
- **`ai-slop/dead-code` recognizes more idiomatic patterns (#121).** Improved discrimination on patterns that previously misfired.

### Improved

- **Oxlint config registers conventional bundler-injected globals (#121).** `__DEV__`, `__TEST__`, `__BROWSER__`, `__NODE__`, `__GLOBAL__`, `__SSR__`, `__ESM_BROWSER__`, `__ESM_BUNDLER__`, `__VERSION__`, `__COMMIT__`, `__BUILD__` are now registered as `readonly` globals on every project — eliminates `no-undef` noise on Rollup/Vite/Webpack `define` flags (e.g. Vue source). A new `OxlintConfigOptions.globals` parameter lets callers pass additional globals.
- **Oxlint discovers ambient globals from project `.d.ts` files (#121).** Top-level `declare const|let|var|function|class` declarations are registered as globals. Bun (`@types/bun` or `bun-types` in deps) adds `Bun`; SST projects (`sst.config.ts`) register `$app`, `$config`, `$dev`, `$interpolate`, `aws`, `cloudflare`, `docker`, `sst`, `pulumi`, and similar.
- **Oxlint context-aware filters (#121).** New filter layer suppresses oxlint diagnostics that are correct for general JS but wrong in specific framework contexts (e.g. Astro `<script>` IIFEs, Next.js metadata exports).
- **`scan` filters minified and bundled JS (#121).** `*.min.js`, `*.bundle.js`, `*.min.css` are excluded alongside the existing build-cache patterns; stops surfacing vendored minified assets in non-JS projects.
- **`scan` honors Biome `files.includes` exclusions (#121).** Negated patterns from `biome.json` are merged into the source-file filter so projects that scope Biome to a subset of files automatically get the same scope for aislop.
- **`scan` ignores `.pnpm-store/` (#121).** Joins the existing `node_modules`, `dist`, `build`, etc. prune list.
- **TS-config path alias and workspace discovery extracted (#121).** Moved into `js-import-aliases.ts` and `js-workspaces.ts` for reuse beyond the hallucinated-import engine.
- **Block-collection extracted from narrative-comments (#121).** New `comment-blocks.ts` module reused by `narrative-comments.ts` and `narrative-comments-fix.ts`.

### Pattern fixes

- `GO_DECL_START` matches grouped declarations (`const (`, `var (`, `type (`).
- `PHP_DECL_START` accepts whitespace between visibility modifiers and `function`.

### Tests

32 new regression tests covering the new exemptions and slop signals; total suite at 835/835 passing.

## 0.9.2 (2026-05-19)

Patch fix for a regression introduced during the 0.9.1 merge.

### Fixed

- **Restore `isBuildCacheFile` in the source-file filter (#117).** PR #113 added an exclusion for Vite config-bundle cache artifacts (`*.timestamp-NNN-XXX.{js,mjs,cjs}`); PR #47's `--include` rewrite of the filter chain dropped the call. The helper survived in code but stopped being consulted by the source-file walk, so repos that commit those cache files (e.g. via Storybook's `vite.config.ts.timestamp-…mjs`) saw three spurious `ai-slop/hallucinated-import` errors per scan. Restored the call and added a regression test that creates real Vite cache filenames plus one false-match to guard against future filter rewrites.

## 0.9.1 (2026-05-19)

Patch release focused on accuracy and signal quality on real-world projects: fewer false positives on Vite, Next.js, SolidStart, SST, and Bun setups; smarter complexity thresholds per language and per role; vulnerable-dependency aggregation per package; a new top-rules breakdown in scan output; `--include` pattern support on `scan`; scan-stability hardening; and an enterprise-friendly `init --strict` mode.

### Added

- **`--include` pattern support on `aislop scan` (#47).** Limit scans to specific files or directories with glob patterns: `aislop scan --include "src/**"`. Multiple patterns supported via repeated flags or comma-separated values (`--include "src/**,docs/**"`). `--exclude` takes precedence when both match the same file; config-defined includes merge with CLI-provided ones. Thanks @myke-awoniran.
- **`Top findings` breakdown in scan output (#113).** Between the score/stats line and the next-steps section, every scan now renders the top 10 rules by count with severity tags, fixable count, and a `+N more rules` footer when truncated. Rule IDs render as plain-English labels via a new `output/rule-labels.ts` registry (e.g. `complexity/function-too-long` → `Function too long`) with the canonical ID muted in parentheses.
- **`Diagnostic.detail` field (#113).** Carries per-instance context (file size, function name, duplicate-block source line). Engines now emit a stable message per rule and the renderer naturally groups all instances into one block, with each location showing its own detail aligned next to the file path.
- **`aislop init --strict` flag (#111).** Zero-prompt enterprise-grade config: all engines enabled, typecheck on, CI gate at 85, GitHub workflow scaffolded.
- **Agent accountability metadata in hook feedback (#111).** Hook responses now thread the active agent identity (claude / cursor / gemini / etc.) and the touched files as structured `accountability` metadata.
- **`qualityGate` exposed in MCP `aislop_scan` result (#111).** Agents can read the project's gate threshold directly without parsing config files.

### Changed

- **Vulnerable-dependency reporting aggregated per package (#113).** When an audit returns many advisories for the same package, they now collapse into a single diagnostic with the worst severity and the highest semver upgrade target — instead of one row per CVE plus repeated `package.json` location lines. Drops the redundant `Run aislop fix -f` boilerplate from each finding (already in next-steps), normalises `None` recommendations to `no fix available`, and moves the audit source (`pnpm` / `npm`) into the `detail` column.
- **Per-language complexity thresholds (#113).** `complexity/file-too-large` now multiplies the base by `2.5×` for `.rs`, `1.5×` for `.go`, `1.5×` for `.tsx`/`.jsx`, and exempts `.d.ts` entirely. `complexity/function-too-long` multiplies by `2.0×` for PascalCase functions in `.tsx`/`.jsx` (components legitimately carry more lines than a utility function) and `1.5×` for Rust functions.
- **Default CI quality gate aligned with public docs (#112).** `ci.failBelow` now defaults to `70`, matching the documented threshold.
- **Ruff scoped to project files (#112).** Format/lint runs against the source files aislop selects, not the whole repo. Cuts noise and speed regressions on monorepos.
- **Terminal wrap cap raised 100 → 120 columns (#113).** Long messages on modern terminals no longer wrap mid-line.

### Fixed

- **Vite virtual modules no longer flagged as hallucinated imports (#113).** Strips Vite import-query suffixes (`?worker`, `?sharedworker`, `?worker-url`, `?url`, `?raw`, `?inline`, `?init`) before checking; recognises `~icons/` virtual modules (unplugin-icons); whitelists `unfonts.css` when `unplugin-fonts` is in the manifest; whitelists the bare `bun` runtime specifier (parallel to `node:fs`).
- **TypeScript `baseUrl`-resolved imports honored (#113).** `compilerOptions.baseUrl` is now read alongside `paths`; directories at baseUrl are treated as importable bare specifiers (`import x from "hooks/useFoo"` when `<baseUrl>/hooks/` exists), matching how the `bundler` resolver and Next.js behave.
- **Auto-imported icon globals no longer flagged as undefined (#113).** When `unplugin-icons` is in any workspace `package.json`, identifiers matching `^Icon[A-Z]` are dropped from `eslint/no-undef`.
- **`Bun` runtime global no longer flagged (#113).** Skipped when `@types/bun` or `bun-types` is in deps.
- **SST platform globals honored in `sst.config.ts` (#113).** Files containing `/// <reference path="...sst/platform/config.d.ts" />` opt into a large ambient surface that oxlint can't follow via triple-slash references; `eslint/no-undef` is dropped for those files.
- **`_`-prefixed unused vars no longer flagged (#113).** `eslint/no-unused-vars` skips identifiers starting with `_`, matching the standard intentionally-unused convention.
- **`import/default` false positives on Vite worker imports cleared (#113).** Oxlint `import/*` diagnostics whose message references a Vite query suffix are dropped.
- **Next.js `public/` and Vite cache files no longer scanned (#113).** `public/` (static-asset directory; vendored JS lives there) is excluded from the source walk. `*.timestamp-NNN-XXX.{js,mjs,cjs}` Vite config-bundle cache files are dropped. Oxlint output is post-filtered with the same rules so files it discovers via `oxlint .` are also skipped.
- **Identical locations no longer duplicated in rule groups (#113).** Multiple diagnostics with the same `filePath:line:column` collapse to one entry under the rule header.
- **Large failing scans flush JSON correctly (#112).** `process.exitCode` is set instead of calling `process.exit()` after JSON output, so big payloads land cleanly on stderr/stdout. 15/15 of the GitHub Trending daily top 15 repos now produce parseable JSON; previously several were truncated.
- **Zero-config scope filters tutorial / sample / notebook / agent-skill paths (#112).** Common docs and example directories no longer add noise to fresh-clone scans.

### Internal

- **Python manifest collection extracted (#113).** `requirements.txt` / `pyproject.toml` / `Pipfile` parsing moved into `engines/ai-slop/python-manifest.ts`. Brings the hallucinated-imports engine back under the file-size cap and gives the Python manifest logic a single, focused home.
- **Crash-free zero-config benchmark (#112).** Re-ran the GitHub Trending daily top 15: diagnostics 60,412 → 34,741; JSON output 25.6 MB → 16.1 MB; 0 crashes/timeouts; warning-only-score repos now exit 1.
- 791 tests passing.
- Self-scan: 100 / 100.

## 0.9.0 (2026-05-16)

Minor release replacing the legacy telemetry with a structured, typed event scheme that covers every CLI command, the MCP server, and the agent hooks — without leaking PII. Includes a redaction allowlist guard, debug/dry-run modes, and a stable anonymous install ID.

### Added

- **Telemetry v2 event scheme (#107).** Six events replace the legacy `cli_scan` / `cli_fix` / `cli_ci`:
  - `cli_installed` — fires once per machine, when `~/.aislop/install_id` is first created.
  - `cli_command_started` / `cli_command_completed` — every command (`scan`, `fix`, `ci`, `init`, `doctor`, `rules`, `badge`, and `hook install/uninstall/status/baseline`).
  - `mcp_server_started`, `mcp_tool_called` — the `aislop-mcp` stdio server and each `aislop_scan` / `aislop_fix` / `aislop_why` / `aislop_baseline` tool invocation.
  - `hook_scan_completed` — after a Claude / Cursor / Gemini agent hook finishes its scoped scan.
- **Indexable, flattened properties.** Every event carries `aislop_version`, `node_version`, `os`, `arch`, `schema_version="v2"`, `anonymous_install_id`, `package_manager` (npm / pnpm / yarn / bun / npx / unknown), `is_ci`. Command events add `command`, `language_summary`, per-language flags (`lang_typescript` / `lang_javascript` / `lang_python` / `lang_java`), `file_count_bucket`, `score`, `score_bucket`, `finding_count`, `error_count`, `warning_count`, `fixable_count`, `exit_code`, `duration_ms`, `error_kind`, and flattened per-engine counters (`engine_<name>_issues`, `engine_<name>_ms`). Previously nested `engine_issues`, `engine_timings`, and `languages` were not indexable and could not be broken down.
- **Stable anonymous install ID.** Random UUIDv4 stored at `~/.aislop/install_id` (honors `XDG_STATE_HOME` on Linux), `0600` permissions, atomic write for concurrent-process safety. Replaces the prior `hostname-platform-arch` djb2 hash. Deleting the file re-rolls identity.
- **Redaction allowlist.** Every outgoing property passes through a frozen allowlist at the transport boundary; anything not on the list is dropped. Explicitly never collected: file paths, project names, repo names, branch names, source text, raw diagnostics, secrets.
- **Debug and dry-run modes.** `AISLOP_TELEMETRY_DEBUG=1` prints every outgoing event to stderr as JSON. Combine with `AISLOP_TELEMETRY_DRY_RUN=1` for "what would this command emit?" without sending.
- **`withCommandLifecycle()` wrapper.** New helper that fires `_started` + `_completed` (even on throw) and awaits flush before returning. Replaces inlined `trackEvent({...})` blocks in `scan`, `fix`, `ci`, `init`, `doctor`, `rules`, `badge`, and the hook subcommands.

### Changed

- **Opt-out precedence tweak.** Explicit `telemetry.enabled: true` in `.aislop/config.yml` now overrides the `CI=true` default. Previously CI overrode config. Env vars (`AISLOP_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`) still win over everything. This makes `is_ci=true` a meaningful property when teams explicitly opt in.
- **PostHog `distinct_id` semantics.** Switches from the hostname-based djb2 hash to the new UUIDv4. Anonymous in both cases, but every existing user's identifier resets at next CLI run. Downstream dashboards built on v1 events still receive historical data.
- **Telemetry module split.** Single-file `src/utils/telemetry.ts` (107 lines) replaced by a focused `src/telemetry/` module: `client`, `events`, `lifecycle`, `identity`, `redaction`, `language`, `env`, `index` — each unit with a single purpose and clear boundaries.

### Removed

- **Legacy `cli_scan` / `cli_fix` / `cli_ci` events.** No longer emitted. v1 dashboards continue to work for historical analysis.
- **`src/utils/telemetry.ts`.** Replaced by the modular `src/telemetry/` layer.

### Documentation

- **`docs/telemetry.md` rewritten** to describe v2 events, properties, identity, opt-out precedence, and debug modes.

### Internal

- 6 new test files (36 tests) covering identity, redaction, lifecycle, language, env, and the opt-out precedence rules. Total: 791 tests passing (up from 755).
- Self-scan: 100 / 100.

## 0.8.3 (2026-05-13)

Patch release fixing a hallucinated-import false positive on projects that use TypeScript `compilerOptions.paths` aliases.

### Fixed

- **Respect `tsconfig.json` / `jsconfig.json` path aliases in hallucinated-import detection.** Imports matching a declared path alias (e.g. `import x from "@/components/Foo"` when `paths: { "@/*": ["./src/*"] }` is set) are no longer flagged as hallucinated packages. Walks the root and every workspace package, reads `compilerOptions.paths`, and supports both wildcard (`@/*`) and exact (`#shared`) alias keys. Malformed tsconfig is skipped silently (degraded behavior — the detector still flags as before). Added 5 vitest cases covering wildcard, exact, workspace-scoped tsconfig, `jsconfig.json`, and the malformed-config fallback.

## 0.8.2 (2026-05-10)

Patch release with false-positive reduction for narrative comments and dependency downgrade protection utilities.

### Fixed

- **Reduce false positives in narrative-comment detector.** JSDoc comments now require explicit slop signals (explanatory openers, justification patterns, cross-references) to be flagged. Added support for `e.g.` and `i.e.` as documentation indicators. Line-comment preambles (3+ lines before declarations) are still flagged.

### Added

- **Semver downgrade detection utilities.** Added `parseSemverMin` and `isDowngrade` helpers to `fix-force.ts` for detecting when dependency updates would downgrade packages (e.g., `^13.6.0` → `^12.1.0`). Handles wildcard specs like `^11.x.x` and ignores non-semver shapes (`workspace:*`, git URLs).

### Internal

- Extracted `isNonProductionPath` helper to shared module for reuse across detectors.

## 0.8.1 (2026-05-10)

Documentation update to improve first-run experience.

### Documentation

- **Condense README, prioritize instant scan (#97).** Restructured README to put instant scan command (`npx aislop scan`) at the top. Integrated badge snippet into Quick start section. Added `npx` prefix to all commands for consistency. Removed sample output, moved "Why aislop" and "What it catches" to bottom. Reduced README from 407 lines to 287 lines (-120 lines). Added context to Fix and Hand off to agent sections.

## 0.8.0 (2026-05-09)

Major feature release with MCP server support, TypeScript typecheck engine, expanded multi-language AI slop coverage, and significant false-positive reduction via OSS validation.

### Added

- **MCP server support (#89).** `aislop-mcp` binary now ships with the package. Exposes `scan`, `fix`, `why`, and `baseline` as MCP tools via Model Context Protocol. AI coding assistants (Claude Desktop, etc.) can directly invoke aislop operations.
- **TypeScript typecheck engine (#84).** New lint engine runs `tsc --noEmit` and parses TypeScript compiler diagnostics. Integrates with existing lint scoring, respects tsconfig.json project references. Catches type errors alongside eslint/oxlint findings.
- **Hallucinated-import detector (#86).** Flags imports of packages not declared in any package.json manifest. Walks manifests up to depth 4 for monorepos. Catches AI-generated imports of non-existent packages.
- **Expanded multi-language AI slop patterns (#90).** Added 7 new detectors across Python, Go, and Rust:
  - Python: placeholder exception handlers, generic print debugging
  - Go: library panics in exported functions, TODO/FIXME markers in production
  - Rust: unwrap() chains, unimplemented!() in library code, excessive .clone()
- **Hook envelope v2 + duplicate-import rule (#87).** New hook protocol version with structured responses. Added `ai-slop/duplicate-import` detector that flags redundant imports of the same symbol/module.
- **FileChanged hook subscription (#88).** Claude Code integration now watches `.aislop/config.yml`, `.aislop/rules.yml`, and `package.json` for changes and re-scans automatically.
- **GitHub Step Summary writer (#79).** CI runs now output rich markdown summaries in GitHub Actions UI with per-finding help text, severity badges, and quick-fix suggestions.
- **Improved scoring system (#74).** New formula with per-engine caps, file-aware density smoothing, and fixable-issue discount. More stable scores across project sizes, less penalty for auto-fixable findings.

### Fixed

- **False-positive reduction via OSS validation (#91).** Validated detectors against 25 real OSS projects (requests, flask, fastapi, cobra, gin, hugo, clap, ripgrep, tokio, serde, prisma, trpc, zod, vitest, nest, express, lodash, axios, chalk, commander). Eliminated ~4,100 false positives:
  - `narrative-comment` now skips Rust doc comments (///), Go doc conventions, and JSDoc with WHY markers
  - `trivial-comment` skips rustdoc and vendored/example directories
  - `console-leftover` exempts CLI command source directories
  - `go-library-panic` exempts nil-check preconditions
  - `hallucinated-import` walks package.json manifests to depth 4 for monorepos
  - `file-too-large` adds 10% buffer over configured max (consistent with function-too-long)
  - All detectors now skip test files, migrations, fixtures, snapshots, mocks, and generated output across all languages
- **Contributors tracking (#83).** Squash-merged PRs now correctly attribute external contributors. Previously only direct committers appeared in contributor lists.
- **Dependency audit warnings (#76).** Missing audit tools (npm audit, cargo audit, etc.) now show clear warning messages instead of silent failures.
- **Dogfooding cleanup (#92).** Split `fixNarrativeComments` into separate file to keep under file-too-large threshold. Fixed pnpm-workspace.yaml regex pattern.

### Documentation

- **Positioning refinement (#85).** Locked "standards layer and quality gate" framing in README and npm description. Clarifies aislop's role as enforcement infrastructure, not a linter replacement.
- **PR check clarifications (#80).** Updated documentation explaining aislop's PR checks and CI integration patterns.

### Internal

- 16 commits land on develop including 8 new features, 4 fixes, and 2 documentation updates.
- 674 tests passing (up from 630).
- 8 new detectors added (1 hallucinated-import + 7 multi-language patterns + duplicate-import).
- Self-scan: 100/100.

## 0.7.0 (2026-05-01)

Two user-facing additions plus a security floor on a transitive dependency.

### Added

- **`extends:` in `.aislop/config.yml` (#45).** Inherit a parent config and override only the keys you need. Accepts a single relative path or an array; later entries win on conflict. Nested objects deep-merge key-by-key, arrays replace wholesale. Circular references and chains deeper than 5 are rejected at load time. Useful for org-wide baselines: one strict parent in the monorepo root, per-package overrides for `ci.failBelow` or specific weights. Documented in [`docs/configuration.md`](docs/configuration.md#extending-a-shared-config).
- **Public score badge in the README header (#46).** Shields-compatible SVG served from `badges.scanaislop.com`, edge-cached. Drop one line into any README that opts in:
  ```markdown
  [![aislop](https://badges.scanaislop.com/score/<owner>/<repo>.svg)](https://scanaislop.com/<owner>/<repo>)
  ```
  Colour bands: green ≥ 85, amber 70–84, red < 70, grey if no scans yet. The CLI's own README now wears the badge alongside `npm version`, `CI`, and `License`.

### Security

- **Floor on `postcss` transitive (#49).** Added a `pnpm.overrides` entry pinning `postcss` ≥ 8.5.10 so `aislop scan`'s own `security/vulnerable-dependency` rule no longer fires on this repo. No top-level dep used postcss directly; the override is the right tool over a runtime dep that doesn't exist. Resolved version is `8.5.13`.

### Internal

- 8 commits land on develop including 3 auto-syncs from the `main → develop` workflow added in 0.6.2.
- A draft PR (#48) parks an unwired TypeScript-as-lint engine — the implementation is solid but the registry, schema, config gate, and tests are deliberately not in this release.

## 0.6.2 (2026-04-22)

Single-finding patch: the knip-backed `Unlisted binary` rule was firing on `.github/workflows/**` for runner-provided tools like `gh`, `aws`, `docker`, and `jq`, which can never be declared in `package.json`.

### Fixed

- **`knip/binaries` no longer flags CI workflow files.** `src/engines/code-quality/knip.ts` now routes every issue through `shouldIncludeIssue(issueType, filePath)`; the predicate drops `binaries` diagnostics whose file path lives under `.github/workflows/`. Backslashes are normalised so Windows paths behave the same. The rule stays active everywhere else, so an npm script invoking an undeclared tool is still a real signal.

### Tests

- 3 new unit tests in `tests/knip-deps.test.ts` covering the predicate: workflow binaries dropped, non-workflow binaries kept, other issue types unaffected in workflow files. Total suite: 617 (614 + 3).

## 0.6.1 (2026-04-20)

A follow-up round after 0.6.0 went live: hook UX gaps surfaced on first contact, README was still on 0.5.x, and adding deterministic duplicate-detection caught real issues in aislop's own source.

### Added

**Hook UX fixes.**
- **Per-agent `--<name>` flags on `install` / `uninstall`.** `aislop hook install --claude`, `--cursor --gemini`, `--copilot`, etc. Matches the existing `fix --claude` pattern so there's one way to select an agent across the CLI.
- **Positional agent args on `install` / `uninstall`.** `aislop hook install claude cursor` and `aislop hook uninstall gemini` now work. Previously they threw "too many arguments."
- **Interactive multi-select picker** on `aislop hook install` / `aislop hook uninstall` when no agents are specified and stdin is a TTY. Space to toggle, enter to confirm. Install defaults check the four agents that support both user and project scopes (Claude, Cursor, Gemini, Codex); uninstall only shows agents actually detected on disk. Non-TTY (CI) keeps the previous default-all behaviour.
- **Interactive-TTY guard on the internal `hook claude` / `hook cursor` / `hook gemini` subcommands.** Invoking one yourself at a terminal used to silently no-op (reading stdin from a TTY yields nothing). Now prints a hint pointing to `hook install --<agent>`.

**Three new deterministic detection rules.**
- `code-quality/repeated-chained-call` — flags 5+ consecutive method calls on the same chain that differ only in string literals. Catches the `.option("--claude", ...)` × 14 pattern.
- `code-quality/duplicate-block` — sliding 10-line window, literal-only normalisation, requires ≥7 distinct lines. Catches non-trivial copy-paste across a file.
- `ai-slop/narrative-comment` widened with a **"bare section label"** detector for 1–3-word title-case comments (`// Subcommands`, `// Init helpers`) NOT followed by a data-literal entry, so `// AWS` in a `SECRET_PATTERNS` array is correctly spared.

**Coverage widening (gaps surfaced by real-world use):**
- `ai-slop/trivial-comment` verb list gained **Write, Run, Parse, Execute, Extract, Save, Load, Build, Start, Stop, Cleanup, Setup, Configure, Validate, Process, Queue, Fire, Emit, Dispatch, Log, Print, Render** plus coverage for single-word bare imperatives (`// Cleanup`, `// Parse`). The rule now uses one consolidated verb-stem regex instead of 14 per-verb patterns.
- `ai-slop/narrative-comment` now also flags **3+ line prose blocks inside function bodies** (previously only caught at the top level before a declaration). The threshold is exempted when the prose contains WHY markers (`because`, `since`, `otherwise`, `workaround`, `note:`, `bug`, `issue`, `in prod`, `must run`, `see issue`, etc.), so genuine explanatory context still passes through.

**Suppression mechanism.** `// aislop-ignore-file <rule>` at the top of a file, or `// aislop-ignore-next-block <rule>` above a specific construct. Lets you opt out of a rule on code where the pattern is intentional (e.g. a diagnostic-push table that reads better as N similar blocks than as a data-driven loop).

**Config-driven file exclusion (thanks [@myke-awoniran](https://github.com/myke-awoniran)).** `exclude:` key in `.aislop/config.yml` and `--exclude <pattern>` on the CLI, both glob-supported via `micromatch`. Defaults cover `node_modules`, `.git`, `dist`, `build`, `coverage`. User excludes stack: CLI overrides config, config stacks on defaults. Applied uniformly across full-scan, `--staged`, and `--changes` modes.

### Changed

- **`README.md` covers hooks.** New "Install as a native hook" section under Usage with adapter + rules-only installer lists, quality-gate flow, and a link to [`/docs/hooks`](https://scanaislop.com/docs/hooks). Quick-start and "Why aislop" blocks mention hooks. Sample-output version banner bumped to 0.6.1.
- **Internal refactors** driven by the new rules:
  - `src/commands/doctor.ts`: extracted `systemToolDecision()` + `firstMatching()` + `FORMAT_SPECS` / `LINT_SPECS` / `AUDIT_SPECS` data tables, replacing six repeated `if (languages.includes(X)) return installedTools[Y] ? {...} : {...}` blocks.
  - `src/utils/source-masker.ts`: extracted `handleQuotesAndComments()` — the string/template/comment state machine was duplicated across the top-level and inside-interpolation branches.
  - `src/engines/ai-slop/dead-patterns.ts`: `slop()` helper replaces 8 inline `diagnostics.push({ engine: "ai-slop", category: "AI Slop", column: 0, ... })` copy-pastes.
  - `src/cli.ts`: extracted `runScan()` (shared between top-level default action and `scan` subcommand), `matchFixAgent()` + `FIX_AGENT_FLAGS` table (drives the `fix --<agent>` registration), `noFlagsPassed()` predicate.
  - Hook command wiring moved to `src/cli/hook-command.ts`, split into `registerInstall` / `registerUninstall` / `registerCallbacks` helpers.

### Notes

- **614 tests passing** (598 baseline + 16 new across `resolveAgents`, `repeated-chained-call`, `duplicate-block`, widened trivial verbs, and inside-function narrative prose).
- Self-scan: **100 / 100 Healthy**, 0 findings.
- No breaking changes. `--agent <names>` still works; it's one of four equivalent ways to select agents now.
- Packaged size: 138 kB (15 files).

## 0.6.0 (2026-04-20)

Agent integration hooks. `aislop` now plugs into Claude Code, Cursor, and Gemini CLI natively so you get machine-readable findings on the turn the agent wrote the code, not after.

### Added
- **Agent hooks for 9 agents** via `aislop hook install --agent <name>` (or `aislop hook claude`, `cursor`, `gemini` shortcuts):
  - **Runtime adapters (3)** that scan and feed findings back to the agent every edit:
    - Claude Code (`PostToolUse` on `Edit|Write|MultiEdit`)
    - Cursor (`afterFileEdit`)
    - Gemini CLI (`AfterTool`)
  - **Rules-only installers (6)** for agents without a hook lifecycle (install writes an `AISLOP.md` rules file the agent reads): Codex, Windsurf, Cline + Roo, Kilo Code, Antigravity, Copilot.
- **`aislop hook` command** with `install / uninstall / status / baseline / claude / cursor / gemini` subcommands. Every install is sentinel-guarded (SHA-256 hash fence) for idempotent re-runs and exact uninstall.
- **Structured feedback contract (`aislop.hook.v1`)** the agent receives: score, counts, top-20 findings, `nextSteps`, and a `regressed` flag vs baseline.
- **Quality-gate mode (opt-in, `--quality-gate`)**: `.aislop/baseline.json` captures the score when installed; the Claude Stop hook blocks the session if the score regresses below baseline.
- **`.aislop/hook.lock` recursion guard** (30 s stale window) prevents aislop from scanning itself via its own hook.
- `git diff` fallback for cases where stdin doesn't carry a file path.
- **Swagger / OpenAPI / apidoc JSDoc now recognised as meaningful.** The narrative-comment rule no longer flags `@swagger`, `@openapi`, `@route`, `@group`, `@summary`, `@operationId`, `@response[s]`, `@requestBody`, `@security`, `@tag[s]`, `@path`, `@body`, `@query`, `@header[s]`, `@produces`, `@accept`, `@middleware`, `@api*` (apidoc family), and other legitimate API-doc tags. Existing projects that had `@swagger` blocks auto-deleted on earlier versions can regenerate them safely.

### Changed
- Narrative-comment detection widened (inherited from develop) with better declaration-preamble recognition across TS / JS / Python / Go / Rust / Ruby / Java / PHP.

### Fixed
- `pnpm audit` retired-endpoint (410) now falls back to `npm audit fix` when a `package-lock.json` exists, layered on top of 0.5.1's `pnpm.overrides` writer.
- **`npx aislop scan --json` clean stdout under `npx`.** `scripts/postinstall-tools.mjs` previously wrote `[aislop] Downloading …` progress to stdout. In CI (where npx always re-downloads because there's no cache) this prefix corrupted the JSON envelope, so any consumer parsing `aislop scan --json` got invalid JSON and defaulted to `score: 0`. Fixed by routing all install progress to stderr.
- **Release workflow's GitHub Packages publish.** `setup-node@v6` with only `registry-url` doesn't emit a scope mapping, so scoped package publishes silently fell back to `registry.npmjs.org` and hit `ENEEDAUTH`. Added `scope: '@scanaislop'` and an explicit `--registry` on the publish command so `@scanaislop/aislop` reaches `npm.pkg.github.com`.

### Notes
- 583 tests passing (519 baseline + 64 new). Full coverage across: registry, scan-lock, baseline, adapters (Claude / Cursor / Gemini), install for every supported agent, rules-only uninstall reversibility, and API-doc JSDoc preservation.
- Self-scan: 100 / 100 Healthy.
- Packaged size: 132 kB (15 files).

## 0.5.1 (2026-04-20)

Two bug fixes. One unblocks `aislop fix -f` on pnpm projects, the other makes the file-too-large rule actually honour `maxFileLoc` for JSX/TSX. No new features, no breaking API changes; agent-integration hooks land in 0.6.0 separately.

### Fixed
- **`complexity/file-too-large` now respects config on JSX/TSX**. Previous behaviour silently applied a **2x** multiplier for `.jsx` / `.tsx` files plus a **10% soft buffer**, so `maxFileLoc: 400` actually fired at **881** lines on TSX. The rule is documented as "default max 400 LOC; JSX/TSX 2x" in the skill, but the combined 2x + 10% was neither documented nor configurable, and it meant big React pages sailed past 400 unflagged. New behaviour:
  - `.jsx` / `.tsx` use a **1.5x tolerance** (400 → 600) with **no soft buffer**.
  - Every other extension (`.ts`, `.js`, `.py`, `.go`, `.rs`, `.rb`, `.java`, `.php`, `.mjs`, `.cjs`) hits the exact configured value.
  - This is a tightening for TSX: a `.tsx` file that was fine at 800 lines under 0.5.0 will now flag at 601 lines. If that's a step too far for your repo, bump `.aislop/config.yml` → `maxFileLoc` explicitly.
- **`aislop fix -f` pnpm dep-audit fix**. Previously tried to run `pnpm audit --fix`, which doesn't exist. Now parses `pnpm audit --json` and writes surgical `pnpm.overrides` entries keyed on `<pkg>@<vulnerable_versions>` into the root `package.json`.

### Changed
- Internal refactor: `src/engines/ai-slop/narrative-comments.ts` (416 → 358 lines) splits its pattern regexes into `narrative-comments-patterns.ts`. `src/engines/code-quality/complexity.ts` (416 → 241 lines) splits its function-boundary detection into `function-boundaries.ts`. No behaviour change.

### Tests
- 3 new complexity tests covering the 1.5x JSX tolerance: `.tsx` at 1.5x, `.jsx` at 1.5x, `.ts` at exact limit. Total suite: 516 → 519 passing.

## 0.5.0 (2026-04-16)

Two big threads landed together:

1. **Full CLI UX rehaul.** Every command rewritten around a new `src/ui/` module with a clack-style visual language. live concurrent engine grid for `scan`, live rail flows for `fix` / `init` / `doctor`, `wcwidth`-aware alignment, accent-green arrows on every hint line, and a proper non-TTY contract for CI.
2. **In-house unused-declaration removal engine.** aislop now owns the most destructive category of auto-fixes (removing unused functions, variables, classes, types, interfaces, enums) instead of delegating to `oxlint --fix` or `knip --fix`: Those tools kept corrupting user code by deleting declaration signatures and leaving orphan bodies. The new engine uses the TypeScript compiler API, runs a parse-check before writing, and reverts any removal that would break file syntax.

### New
- `src/ui/` module: `theme`, `symbols`, `width`, `logger`, `header`, `summary`, `error`, `rail`, `live-rail`, `live-grid`, `prompts`, `invocation`
- `src/engines/code-quality/unused-removal.ts`: in-house engine for safely removing unused top-level declarations (const / let / var / function / class / type alias / interface / enum) with side-effect guard and parse-check-before-write safety
- Live animated spinner (braille frames) on each rail step while it runs
- `Verifying results…` live step during the post-fix verification scan
- Invocation-aware hints: all printed commands render as `npx aislop …` so copy-paste works regardless of install method (global, devDep, fresh npx)
- `--human` flag on `aislop ci` to re-enable the full human design in CI output
- JSON output gains `schemaVersion: "1"` and `cliVersion` at the top of the envelope
- Biome lint rule blocks `picocolors` imports outside `src/ui/`
- `renderHintLine` helper: single source of truth for the accent-green `→` arrow + hint text pattern used across `scan` / `fix` / `doctor` / `init` / `rules` / `--help`
- Top-level `--help` and every subcommand `--help` now show the brand header (`aislop 0.5.0 · the quality gate for agentic coding`) via commander's `beforeAll` hook
- `RailStep` gained a `"warn"` status (yellow `!`) so steps that complete with unresolved items don't misleadingly show `◆` (done)

### Changed
- Scan shows all six engines updating concurrently in a live grid with aligned columns (label 18, status 12, elapsed 6) and wcwidth-aware padding
- Fix renders live. Each step appears as `◇ Step…` with a spinner while running, then resolves to `◆ / ! / ✗ Step. <result>` and emits a `│` connector to the next step
- Fix footer is now `└  Done · N fixed · M remain`, always with a preceding `│`
- Summary counters are color-coded: `N errors` red, `N warnings` yellow, `N fixable` green
- Fix command hint expanded from `fix --agent` to `fix --claude (or --codex, --cursor, --gemini, etc.) to hand off to agent`. Lists common agents inline, mentions `-f` when aggressive fixes apply
- Fix pipeline reordered: unused declarations run **before** lint fixes, so oxlint's safer `--fix` mode sees clean state and no longer touches declarations at all
- Doctor is project-aware: sub-header shows project + primary language, one row per engine with its backing tool, `✗` + inline remediation for missing tools, `─` + "no X in project" for skipped engines, footer shows `Ready · N engines · M missing`
- Rules grouped by engine with aligned severity + fixable columns, plus scan/init next-step hints
- Init is a clack wizard (≤4 prompts), writes `.aislop/config.yml` preserving the existing schema, success rail + `→ Try npx aislop scan` hint
- Interactive menu uses `@clack/prompts`; "Next?" prompt re-uses the full menu so users can pick scan/fix/init/etc. directly instead of going back to a generic menu line
- Init / doctor / fix accept `printHeader: false` when dispatched from the interactive menu, so the brand line doesn't print twice
- SQL-injection detection tightened: requires a DB-like receiver (`db.`, `knex.`, `prisma.`, `pool.`, `sequelize.`, `pg.`, etc.) before flagging template literals. `log.raw(\`…\${x}\`)` and similar no longer false-positive
- `no-control-regex` oxlint rule disabled (ANSI-stripping regexes are a legitimate CLI pattern)
- Vulnerable-dependency diagnostic help lines now read `Run \`npx aislop fix -f\` to apply this fix. Upgrade to version X or later`, directing users to the aggressive-fix path
- Format engine filters out files that no longer exist on disk before calling the formatter, so stale git-status paths from removed files don't produce "No such file or directory" warnings
- `knip --fix` usage scoped to value-export keyword stripping only; type and declaration removal delegated to the new in-house engine

### Fixed
- `oxlint --fix` no longer damages arrow-function declarations by deleting the signature while leaving the body (this was the long-standing class of "file corrupted after `aislop fix`" bug). The engine's `fix` mode turns `no-unused-vars` off entirely; detection still runs with the rule on so warnings surface, and the new unused-removal engine handles them safely
- aislop's own `applyUnusedVarPrefixFixes` had a destructive branch that deleted unused `const` declarations under certain shapes; now only ever prefixes with `_`
- `fix`-then-`scan` is a stable fixed point. Running `fix` a second time produces zero further changes
- Knip's silent `--fix-type=exports,types,duplicates` flag-comma bug worked around by repeating the flag per type
- Doctor no longer emits a useless `4 of 4 tools available` footer listing bundled tools that are always present. It now shows one row per engine with its actual tool and only flags what's missing for languages present in the project

### Removed
- Hand-rolled keypress menu (replaced by clack)
- `src/output/{layout,pager,scan-progress,fix-progress}.ts`
- `src/utils/{highlighter,logger,spinner}.ts`
- `fixKnipUnusedExports` / `runKnipUnusedExports` (consolidated into the unused-removal engine)

### Dependencies
- Added: `@clack/prompts`, `wcwidth`, `@types/wcwidth`
- `typescript` moved from `devDependencies` to `dependencies`. Required at runtime by the unused-removal engine (`ts.createSourceFile`)

### Breaking
- None at the CLI contract level. All flags, exit codes, and JSON field names remain stable.



## [0.2.0] - 2026-03-12

### Added

- **Unused dependency detection**: 5 new rules powered by knip:
  - `knip/dependencies`: unused packages in package.json
  - `knip/devDependencies`: unused devDependencies in package.json
  - `knip/unlisted`: packages imported but missing from package.json
  - `knip/unresolved`: imports that cannot be resolved
  - `knip/binaries`: binaries used but not declared
- **`aislop fix` removes unused dependencies**: detects and removes unused deps/devDeps from package.json automatically
- **GitHub Packages publishing**: each release now also publishes `@scanaislop/aislop` to npm.pkg.github.com
- **Documentation site**: detailed docs moved to `docs/` directory (installation, commands, rules, configuration, scoring, CI/CD, telemetry)
- **Example configs**: `examples/` directory with 4 preset configurations (typescript-strict, monorepo-relaxed, python-go, architecture-rules)
- **Project infrastructure**: `.editorconfig`, `.nvmrc`, `.gitattributes`, `biome.json`, `AGENTS.md`, `knip.json`
- **Acknowledgments**: README now credits the open-source projects aislop is built on
- npm downloads badge in README

### Changed

- README slimmed from 374 to ~185 lines. Reference material moved to docs/
- README restructured: Installation → Usage → Use in project → Why → What it catches
- CONTRIBUTING.md updated to target `develop` branch with AGENTS.md reference
- Expo/React Native documented in supported languages and linting tables
- 288 total tests across 14 test files

## [0.1.3] - 2026-03-12

### Fixed

- Scoring penalties are now proportional to codebase size. A single issue in a 200-file project no longer tanks the score the same as in a 2-file project (fixes #9)
- Add `smoothing` to scoring config schema (was missing, causing TypeScript error)
- Fix `calculateScore` call in scan.ts to pass `sourceFileCount` and `smoothing` as separate arguments (smoothing was previously passed in the sourceFileCount position)
- Compact `countParams` to keep `complexity.ts` under the 400-line limit after biome formatting

### Added

- 52 comprehensive scoring tests covering severity ordering, engine weights, edge cases, and density-aware scoring
- Configurable `scoring.smoothing` option (default: 10) for issue-density normalization
- 285 total tests across 13 test files

## [0.1.2] - 2026-03-11

### Fixed

- False positive: `template.innerHTML` no longer flagged as XSS. `<template>` elements are inert by spec and don't execute scripts (fixes #7)
- `aislop scan` now exits with code 1 when error-severity diagnostics are found, fixing CI pipelines that depend on the exit code (fixes #8)
- Self-detection of `innerHTML` pattern in `risky.ts` via string concatenation

### Added

- 3 new security tests for template innerHTML exception

## [0.1.1] - 2026-03-11

### Added

- Anonymous opt-out telemetry via PostHog for aggregate usage insights
  - Respects `AISLOP_NO_TELEMETRY=1`, `DO_NOT_TRACK=1`, and `telemetry.enabled: false` in config
  - No PII collected; fire-and-forget with no impact on scan performance
  - Disabled automatically in CI environments

### Fixed

- False-positive `function-too-long` warning on `isBlockArrow` caused by the naive brace counter miscounting `{` and `}` characters inside regex literals
- `complexity.ts` trimmed to stay within the 400-line file size limit

## [0.1.0] - 2025-07-14

### Added

- Initial release
- Six detection engines: format, lint, code-quality, ai-slop, architecture, security
- AI slop detection rules:
  - `ai-slop/trivial-comment`: comments that restate the code
  - `ai-slop/swallowed-exception`: empty catch blocks and catch-only-log
  - `ai-slop/thin-wrapper`: functions that only delegate
  - `ai-slop/generic-naming`: AI-style names like `helper_1`, `data2`
  - `ai-slop/unused-import`: unused imports in JS/TS and Python
  - `ai-slop/console-leftover`: console.log/debug/info in production code
  - `ai-slop/todo-stub`: unresolved TODO/FIXME/HACK comments
  - `ai-slop/unreachable-code`: code after return/throw
  - `ai-slop/constant-condition`: `if (true)`, `if (false)`
  - `ai-slop/empty-function`: empty function bodies
  - `ai-slop/unsafe-type-assertion`: `as any` in TypeScript
  - `ai-slop/double-type-assertion`: `as unknown as X`
  - `ai-slop/ts-directive`: `@ts-ignore` / `@ts-expect-error`
- Security rules: hardcoded secrets, eval, innerHTML, SQL injection, shell injection, dependency audit
- Code quality: function/file complexity, nesting depth, parameter count, duplication, dead code (knip)
- Formatting via Biome (JS/TS), ruff (Python), gofmt (Go), cargo fmt (Rust), rubocop (Ruby), php-cs-fixer (PHP)
- Linting via oxlint (JS/TS), ruff (Python), golangci-lint (Go), clippy (Rust), rubocop (Ruby)
- Architecture engine with custom `forbid_import`, `forbid_import_from_path`, and `require_pattern` rules
- Logarithmic scoring model (0-100) with configurable weights and thresholds
- CLI commands: scan, fix, ci, init, doctor, rules, interactive mode
- Support for `--changes` and `--staged` flags for incremental scanning
- JSON output for CI pipelines
- Auto-download of ruff and golangci-lint binaries on install
- Configuration via `.aislop/config.yml` and `.aislop/rules.yml`
- Language support: TypeScript, JavaScript, Python, Go, Rust, Ruby, PHP, Java (detection)
- Framework detection: Next.js, React, Vite, Remix, Expo, Django, Flask, FastAPI

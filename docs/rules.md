# Rules Reference

`aislop` groups checks into six engines. Each engine runs in parallel for speed.

## Formatting

Enforces consistent formatting using the best tool for each language.

| Language | Tool |
|---|---|
| TypeScript / JavaScript | Biome |
| Python | ruff format |
| Go | gofmt |
| Rust | cargo fmt |
| Ruby | rubocop |
| PHP | php-cs-fixer |

## Linting

Catches bugs and bad practices.

| Language | Tool |
|---|---|
| TypeScript / JavaScript | oxlint (bundled, with React/Next.js awareness) |
| Expo / React Native | expo-doctor (project health, dependency checks) |
| Python | ruff |
| Go | golangci-lint |
| Rust | clippy |
| Ruby | rubocop |

## Code Quality

Measures structural complexity, finds dead code, and detects unused dependencies.

| Rule | What it checks |
|---|---|
| `complexity/function-too-long` | Functions exceeding configurable line limit (default: 80). For Python, measured by logical body code: the signature, docstrings, comments, and blank lines do not count. `async def` and multi-line wrapped signatures are detected. |
| `complexity/file-too-large` | Files exceeding configurable line limit (default: 400) |
| `complexity/deep-nesting` | Control-flow nesting beyond threshold (default: 5) |
| `complexity/too-many-params` | Functions with too many parameters (default: 6). For Python, counts required parameters only: `self`/`cls`, `*args`/`**kwargs`, the `*` / `/` separators, and parameters with a default are not counted. |
| `code-quality/duplicate-block` | Repeated blocks of implementation code that should usually be extracted or shared |
| `code-quality/repeated-chained-call` | Repeated long call chains on the same receiver that should usually be cached or factored |
| `code-quality/unused-declaration` | Unused top-level declarations detected for safe removal |
| `knip/files` | Unused files not imported anywhere (JS/TS, fixable with `fix -f`) |
| `knip/exports`, `knip/types` | Unused exports and types (JS/TS) |
| `knip/dependencies` | Unused dependencies in package.json (fixable with `fix`) |
| `knip/devDependencies` | Unused devDependencies in package.json (fixable with `fix`) |
| `knip/unlisted` | Packages imported in code but missing from package.json |
| `knip/unresolved` | Imports that cannot be resolved |
| `knip/binaries` | Binaries used but not declared in package.json |
| `knip/duplicates` | Duplicate exports reported by knip |

## AI Slop

The rules that make aislop unique. These catch the patterns AI assistants leave behind.

| Rule | Severity | What it catches |
|---|---|---|
| `ai-slop/trivial-comment` | warning | Comments restating the code (`// Import React`, `// Return the value`) |
| `ai-slop/narrative-comment` | warning | Decorative separators, phase/section headers, JSDoc preambles without meaningful tags (caught on top-level *and* interface/type members), cross-reference commentary, and longer prose blocks that carry an AI-narration signal (a restatement opener or step-by-step narration). Length alone is not flagged. |
| `ai-slop/swallowed-exception` | error | Empty catch blocks, catch blocks that only log (JS/TS/Python/Go/Ruby/Java) |
| `ai-slop/silent-recovery` | warning | Catch blocks that log without including the caught error and then continue |
| `ai-slop/meta-comment` | warning | Comments about implementation phases, agent behavior, or generated-code process instead of the code itself |
| `ai-slop/hidden-fallback` | warning | JS/TS fallback logic that turns missing counts, failed diagnostics, or impossible states into safe-looking values without surfacing the missing input or failure |
| `ai-slop/redundant-try-catch` | warning | JS/TS catch blocks that only rethrow the same error without adding context, cleanup, or recovery |
| `ai-slop/redundant-type-coercion` | warning | TypeScript primitive parameters re-coerced with `String(...)`, `Number(...)`, or `Boolean(...)` |
| `ai-slop/duplicate-type-declaration` | warning | Exported TypeScript type/interface declarations repeated with the same name and shape across files |
| `ai-slop/thin-wrapper` | warning | Functions that only forward their own parameters unchanged to another function (a call that transforms its arguments is not flagged) |
| `ai-slop/generic-naming` | info | AI-generated names: `helper_1`, `data2`, `temp1` |
| `ai-slop/unused-import` | warning | Unused imports (JS/TS and Python) |
| `ai-slop/unused-css` | warning | Custom CSS/SCSS classes defined in stylesheets but referenced nowhere in the project (className/`cn`/`clsx`/template literals/`data-*`/HTML/JSX). Tailwind/utility-looking classes are skipped, and any class whose name appears as a substring in any source string (e.g. an interpolation prefix like `ui-`) is spared. Project-wide pass; conservative by design. |
| `ai-slop/console-leftover` | warning | `console.log`/`debug`/`info` left in production code |
| `ai-slop/todo-stub` | info | Unresolved, untracked TODO/FIXME/HACK comments (a TODO that links a tracking issue is spared) |
| `ai-slop/unreachable-code` | warning | Code after `return`/`throw` statements |
| `ai-slop/constant-condition` | warning | `if (true)`, `if (false)`, `if (0)` |
| `ai-slop/empty-function` | info | Empty function bodies |
| `ai-slop/unsafe-type-assertion` | warning | `as any` in TypeScript |
| `ai-slop/double-type-assertion` | warning | `as unknown as X` pattern |
| `ai-slop/ts-directive` | info | `@ts-ignore` / `@ts-expect-error` usage |
| `ai-slop/duplicate-import` | warning | Multiple imports from the same module that should be merged |
| `ai-slop/hardcoded-url` | warning | Environment-specific URLs hardcoded in production code instead of env/config |
| `ai-slop/hardcoded-id` | warning | Provider/project IDs hardcoded in production code instead of env/config |
| `ai-slop/python-bare-except` | warning | Python `except:` blocks that catch everything without naming an exception type |
| `ai-slop/python-broad-except` | warning | Python broad exception handlers with silent/pass-style bodies |
| `ai-slop/python-mutable-default` | warning | Python function defaults such as `[]`, `{}`, or `set()` that are shared across calls |
| `ai-slop/python-print-debug` | warning | Python `print(...)` debug output left in production modules |
| `ai-slop/python-range-len-loop` | info | Python `for i in range(len(items))` loops that usually want direct iteration or `enumerate()` |
| `ai-slop/python-chained-dict-get` | warning | Python `.get(..., {}).get(...)` fallback chains that hide missing-data cases |
| `ai-slop/python-repetitive-dispatch` | warning | Repeated Python equality branch ladders that should usually become a table/set/handler map |
| `ai-slop/python-isinstance-ladder` | warning | Repeated Python `isinstance(...)` ladders that should usually become a handler map or normalized representation |
| `ai-slop/go-library-panic` | warning | Go `panic(...)` calls in non-main library code unless clearly intentional |
| `ai-slop/rust-non-test-unwrap` | warning | Rust `.unwrap()` in production code where errors should be handled or documented |
| `ai-slop/rust-todo-stub` | warning | Rust `todo!()` stubs in production code |
| `ai-slop/hallucinated-import` | error | Imports of JS/TS packages that are not declared in the project manifest |

## Security

Finds secrets, risky constructs, and vulnerable dependencies.

| Rule | What it catches |
|---|---|
| `security/hardcoded-secret` | API keys, AWS credentials, JWT tokens, database URLs, passwords |
| `security/eval` | `eval()` usage (JS/TS/Python/Ruby/PHP) |
| `security/innerhtml` | Direct `.innerHTML` assignment |
| `security/dangerously-set-innerhtml` | React `dangerouslySetInnerHTML` usage that needs sanitization |
| `security/sql-injection` | String concatenation in SQL queries |
| `security/shell-injection` | User input in command execution |
| `security/vulnerable-dependency` | npm/pip/cargo/go dependency audit |
| `security/dependency-audit-skipped` | Dependency audit could not run because tooling or lockfile context was missing |

## Architecture (opt-in)

Custom import and path rules defined in `.aislop/rules.yml`. Enable with `engines.architecture: true` in your config.

| Rule type | Example |
|---|---|
| `forbid_import` | Ban `axios` project-wide |
| `forbid_import_from_path` | Controllers cannot import database modules |
| `require_pattern` | Require error handling in API routes |

See [examples/architecture-rules.yml](../examples/architecture-rules.yml) for a sample rules file.

## Supported Languages

| Language | Format | Lint | Code quality | AI slop | Security |
|---|---|---|---|---|---|
| TypeScript | Biome | oxlint | knip, complexity | All rules | All rules |
| JavaScript | Biome | oxlint | knip, complexity | All rules | All rules |
| Expo / React Native | Biome | oxlint + expo-doctor | knip, complexity | All rules | All rules |
| Python | ruff | ruff | complexity | Imports, exceptions, comments | Secrets, audit |
| Go | gofmt | golangci-lint | complexity | Exceptions, comments | Secrets, audit |
| Rust | cargo fmt | clippy | complexity | Comments | Secrets, audit |
| Ruby | rubocop | rubocop | complexity | Exceptions, comments | Secrets |
| PHP | php-cs-fixer | -- | complexity | Comments | Secrets |

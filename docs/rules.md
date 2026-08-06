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
| C/C++ | clang-format (requires `.clang-format` in the repo) |

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
| C# | jb inspectcode + Roslynator + AsyncFixer/Meziantou (optional, requires .NET SDK; each tool toggleable independently) |
| C/C++ | cppcheck + clang-tidy + optional jb inspectcode/ReSharper C++ (clang-tidy requires `compile_commands.json`; jb is off by default and needs Windows + MSVC; all are system tools, not bundled) |

### C# linting: hybrid jb + Roslynator

The C# lint pass is a **hybrid of two independently togglable tools** that both run when available, with findings merged and de-duplicated:

- **jb inspectcode** (`jb/*` rules) - ReSharper-native inspections via the JetBrains CLI
- **Roslynator** (`dotnet/*` rules) - Roslyn analyzer diagnostics

Both tools run by default when available: each runs only when it is enabled (both default to on) AND its CLI is installed AND a `.csproj`/`.sln` is present. Missing tooling is silently skipped.

**Restore-evidence gate.** With a solution file at the repo root, the whole solution is analyzed in one pass. Without one, both tools fan out per `.csproj` - and every project costs a full MSBuild workspace load, so aislop only analyzes projects with restore evidence (`project.assets.json`, written by `dotnet restore` or a build, in `obj/` beside the project or in an arcade-style central `artifacts/obj/<ProjectName>/`), capped at 32 projects per scan. Skipped projects are reported once per scan as an advisory `dotnet/projects-skipped` info diagnostic rather than silently dropped. This is the C# analogue of clang-tidy gating on `compile_commands.json`: on a cold checkout the build-backed passes step aside instead of serially burning their timeouts, and the text-tier C# rules still run. `dotnet format` applies the same gate silently.

#### jb inspectcode (`jb/*`)

Rules are named `jb/<ReSharper-inspection-id>`, e.g. `jb/RedundantUsingDirective`. jb inspectcode produces ReSharper-native inspections across the full solution.

**Severity mapping:**

| jb severity | aislop severity |
|---|---|
| ERROR, WARNING | warning |
| SUGGESTION, HINT | info |

The floor is controlled by `jbSeverityFloor` (default: `WARNING`). Findings below the floor are dropped. `InconsistentNaming` is excluded by default because it binds to a machine-global ReSharper config and produces unreliable results via the CLI.

**Install:**

```bash
dotnet tool install -g JetBrains.ReSharper.GlobalTools
```

#### Roslynator (`dotnet/*`)

Shells out to the [`roslynator`](https://github.com/dotnet/roslynator) CLI and reports a curated subset of analyzer diagnostics, each prefixed `dotnet/`:

| Rule | What it catches |
|---|---|
| `dotnet/AsyncFixer01` | Unnecessary `async`/`await` (the await is the last statement) |
| `dotnet/AsyncFixer02` | Long-running or blocking operations inside an `async` method |
| `dotnet/AsyncFixer03` | Fire-and-forget `async void` - unhandled exceptions crash the process |
| `dotnet/MA0040` / `MA0042` / `MA0045` | Meziantou async/`Task` best practices (cancellation tokens, blocking calls) |
| `dotnet/CS0219` / `CS0162` | Unused variable / unreachable code (compiler diagnostics) |
| `dotnet/IDISP001` | An `IDisposable` is created but never disposed (resource leak; from IDisposableAnalyzers) |
| `dotnet/projects-skipped` | Advisory notice: projects without restore evidence (or beyond the 32-project cap) were not analyzed by the build-backed passes |

**Install:**

```bash
dotnet tool install -g roslynator.dotnet.cli
```

aislop bundles the AsyncFixer, Meziantou.Analyzer, and IDisposableAnalyzers assemblies so these rules fire even on projects that don't reference them. Where Roslynator reports an accurate async finding, the approximate Phase-1 regex rule (`ai-slop/csharp-async-void` / `ai-slop/csharp-sync-over-async`) at the same line is suppressed so you never see both.

#### De-duplication

When both tools run, findings are merged and de-duplicated by `(filePath, line, bare-rule-id)`, where the bare rule id is the part after the `jb/` or `dotnet/` namespace prefix (so a `jb/CS0219` and a `dotnet/CS0219` at the same site count as one). When jb and roslynator report an equivalent finding at the same location, the jb finding wins.

#### `lint.csharp` config block

Both passes are independently togglable via the `lint.csharp` config block:

```yaml
lint:
  csharp:
    projectEvaluation: false              # opt in only for repositories you trust
    jb: true                              # run jb inspectcode if installed
    roslynator: true                      # run roslynator if installed
    jbSeverityFloor: WARNING              # ERROR | WARNING | SUGGESTION | HINT
    jbExcludeTypes: [InconsistentNaming]  # CLI-unreliable; bound to machine-global config
    # jbProjects: "MyApp*"               # optional --project glob to scope big solutions
```

| Field | Default | Description |
|---|---|---|
| `projectEvaluation` | `false` | Allow MSBuild-backed lint, format, and NuGet audit passes. These may evaluate repository-controlled project files; enable only for repositories you trust. |
| `jb` | `true` | Run jb inspectcode when installed |
| `roslynator` | `true` | Run roslynator when installed |
| `jbSeverityFloor` | `WARNING` | Drop jb findings below this severity |
| `jbExcludeTypes` | `["InconsistentNaming"]` | Inspection type IDs to exclude from jb results |
| `jbProjects` | (unset) | Optional `--project` glob passed to jb inspectcode to scope analysis in large solutions |

### C/C++ linting: cppcheck, clang-tidy, and (optional) jb inspectcode

The C/C++ lint pass shells out to system tools (none are bundled):

- **cppcheck** (`cppcheck/*` rules) - runs on any C/C++ checkout; no extra files required
- **clang-tidy** (`clang-tidy/*` rules) - runs only when a `compile_commands.json` is present (generated by CMake with `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`, or by Bear/intercept-build)

**Chunked invocation.** cppcheck runs once per deterministic chunk of source files (see `chunkFilePaths`) rather than in a single invocation, so a large enough tree cannot exceed the OS command-line length limit. Each chunk has a 180s timeout. If a chunk times out or otherwise fails to run, its files are not analyzed and their findings are absent from that scan; this is reported once per scan as an advisory `cppcheck/chunks-skipped` info diagnostic rather than silently dropped, alongside a per-chunk stderr warning identifying the affected files. Recover the skipped findings by re-running cppcheck directly on the named files or investigating why the chunk timed out or failed.

`clang-tidy` discovery is intentionally flexible for common build outputs:

- `build/compile_commands.json`
- `build/<Configuration>/compile_commands.json` (for multi-config/partitioned CMake outputs)
- `out/compile_commands.json`
- `cmake-build-*/<...>/compile_commands.json`

Example CMake commands:

```bash
cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
cmake --build build
```

If your CI writes the database in a different subdirectory, keep that directory stable across runs so aislop can find it.

- **jb inspectcode** (`jb/Cpp*` rules) - ReSharper C++ inspections via the JetBrains CLI, OFF by default (enable with `lint.cpp.jb`). The same `jb` tool used for C# also inspects C++ projects in a loadable solution; it requires Windows + MSVC for the MSBuild project model.
Findings from all active tools are merged and de-duplicated by `(filePath, line, canonical-rule-id)`. The canonical id collapses jb's clang-tidy-backed inspections (`jb/CppClangTidyBugproneNarrowingConversions`) onto the matching standalone clang-tidy id (`clang-tidy/bugprone-narrowing-conversions`) so the same defect is not double-counted.

The C/C++ lint pass is configurable via the `lint.cpp` block:

```yaml
lint:
  cpp:
    cppcheck: true                 # run cppcheck if installed
    clangTidy: true                # run clang-tidy if a compile DB is present
    cppcheckEnable: "warning,performance,portability"
    jb: false                      # run jb inspectcode (ReSharper C++) over C++ projects
    jbSeverityFloor: WARNING        # ERROR | WARNING | SUGGESTION | HINT
    jbExcludeTypes: []             # jb TypeIds to exclude from C++ results
    # jbProjects: "MyNative*"      # optional --project scope for jb's C++ pass
```

| Field | Default | Description |
|---|---|---|
| `cppcheck` | `true` | Run cppcheck when installed |
| `clangTidy` | `true` | Run clang-tidy when a `compile_commands.json` is present |
| `cppcheckEnable` | `warning,performance,portability` | cppcheck `--enable` set |
| `jb` | `false` | Run jb inspectcode over C++ projects (requires `jb` + a loadable solution; Windows + MSVC) |
| `jbSeverityFloor` | `WARNING` | Drop jb C++ findings below this severity |
| `jbExcludeTypes` | `[]` | jb TypeIds to exclude from C++ results |
| `jbProjects` | (unset) | Optional `--project` scope for jb's C++ pass |

When both C# and C++ jb are enabled, aislop runs a single inspectcode pass over the union of both project scopes and partitions the results by language.

Missing tooling is silently skipped; run `aislop doctor` to see what is detected.

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
| `ai-slop/swallowed-exception` | error | Empty catch blocks, catch blocks that only log (JS/TS/Python/Go/Ruby/Java/C#) |
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
| `ai-slop/tautological-test` | warning | JavaScript/TypeScript assertions comparing equal fixed literals, plus standalone Python `assert True` statements, which cannot fail |
| `ai-slop/csharp-not-implemented` | warning | C# `throw new NotImplementedException()` stubs the agent forgot to fill in |
| `ai-slop/csharp-redundant-doc-comment` | warning | C# XML-doc `<summary>` that just restates the member (`Gets or sets the X`) without adding information |
| `ai-slop/csharp-async-void` | warning | C# `async void` methods that aren't event handlers (can't be awaited; exceptions crash the process) |
| `ai-slop/csharp-sync-over-async` | warning | C# blocking on a Task via `.Result` / `.Wait()` / `.GetAwaiter().GetResult()` (deadlock risk) |
| `ai-slop/csharp-suppressed-warning` | warning | C# `#pragma warning disable` / `[SuppressMessage]` without a justification comment |
| `ai-slop/csharp-empty-catch-rethrow` | warning | C# catch blocks that only rethrow without adding context, cleanup, or recovery |
| `ai-slop/csharp-null-forgiving` | warning | C# null-forgiving `!` operator silencing nullable warnings instead of handling null |
| `ai-slop/csharp-console-leftover` | warning | C# `Console.*` / `Debug.*` / `Trace.*` output left in library code |
| `ai-slop/csharp-broad-catch` | warning | C# `catch (Exception)` that catches everything (non-empty, non-rethrow) instead of the specific type(s) it can handle |
| `ai-slop/csharp-linq-count` | warning | C# `.Count() > 0` / `.Count() == 0` enumerating a whole sequence where `.Any()` short-circuits |
| `ai-slop/csharp-index-loop` | warning | C# index `for` loop over `.Length`/`.Count` that reads more clearly as `foreach` |
| `ai-slop/csharp-if-ladder` | warning | C# chain of 4+ if/else-if branches comparing one value against constants (a `switch` in disguise) |
| `ai-slop/csharp-string-concat-in-loop` | warning | C# string built with `+=` inside a loop (O(n^2) reallocation; use a `StringBuilder`) |
| `ai-slop/cpp-not-implemented` | warning | C++ stub throws `std::logic_error("not implemented")` or `assert(false && "not implemented")` |
| `ai-slop/cpp-using-namespace-std-in-header` | warning | `using namespace std;` at header scope leaks into every translation unit that includes the header |
| `ai-slop/cpp-c-style-cast` | warning | C-style cast in C++ code; prefer `static_cast` / `reinterpret_cast` for explicitness |
| `ai-slop/cpp-manual-delete` | warning | Manual `delete` / `delete[]`; prefer `std::unique_ptr` or RAII containers |
| `ai-slop/cpp-iostream-leftover` | warning | `std::cout` / `std::cerr` left in library code (files without a `main`) |
| `ai-slop/cpp-null-literal` | warning | `NULL` used in C++ (`.cc`/`.cpp`/`.cxx`/`.hh`/`.hpp`/`.hxx`); prefer `nullptr` |
| `ai-slop/cpp-define-constant` | warning | Object-like `#define` constant in C++; prefer `constexpr` / `const` |
| `ai-slop/cpp-endl-in-stream` | warning | `<< std::endl` flushes the stream on every call; prefer `'\n'` |

Note: `ai-slop/trivial-comment`, `ai-slop/narrative-comment`, and `ai-slop/swallowed-exception` also cover C# (`.cs`) and C/C++ (`.c`, `.cpp`, `.h`, `.hpp`).

## Security

Finds secrets, risky constructs, and vulnerable dependencies.

| Rule | What it catches |
|---|---|
| `security/hardcoded-secret` | API keys, AWS credentials, JWT tokens, database URLs, passwords |
| `security/eval` | `eval()` usage (JS/TS/Python/Ruby/PHP) |
| `security/innerhtml` | Direct `.innerHTML` assignment |
| `security/dangerously-set-innerhtml` | React `dangerouslySetInnerHTML` usage that needs sanitization |
| `security/sql-injection` | String concatenation/interpolation in SQL queries (JS/TS, C#) |
| `security/shell-injection` | User input in command execution (JS/TS/Python, C#, C/C++ `system`/`popen`) |
| `security/unsafe-deserialization` | Legacy .NET formatters (`BinaryFormatter`, `SoapFormatter`, ...) that deserialize arbitrary types |
| `security/unsafe-c-call` | Memory-unsafe C string functions (`gets`, `strcpy`, `strcat`, `sprintf`) |
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
| Python | ruff | ruff | complexity | Imports, exceptions, comments, tautological tests (`assert True`) | Secrets, audit |
| Go | gofmt | golangci-lint | complexity | Exceptions, comments | Secrets, audit |
| Rust | cargo fmt | clippy | complexity | Comments | Secrets, audit |
| Ruby | rubocop | rubocop | complexity | Exceptions, comments | Secrets |
| PHP | php-cs-fixer | -- | complexity | Comments | Secrets |
| C# | -- | jb inspectcode + Roslynator (optional, each independently togglable) | complexity | NotImplementedException, redundant XML-doc, async, exceptions, comments | Secrets |
| C/C++ | clang-format (requires `.clang-format`) | cppcheck + clang-tidy (clang-tidy requires `compile_commands.json`) | complexity | Not-implemented stubs, using-namespace-std in headers, C-style casts, manual delete, iostream leftovers | Secrets |

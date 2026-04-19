# Spec: Agent-Integration Hooks

Status: Draft
Owner: aislop maintainers
Target: `aislop` >= 0.6.0

## 1. Problem & goals

AI coding agents (Claude Code, Cursor, Gemini CLI, Codex, Windsurf, Cline/Roo, Kilo Code, Antigravity, Copilot) write code that passes tests but ships with slop: dead imports, `as any` casts, narrative comments, swallowed errors. Today, `aislop` catches this only when the human runs `aislop scan`. The agent never sees its own regressions.

This spec wires `aislop` into each agent's native tool lifecycle so the agent gets **scoped, machine-readable feedback on the files it just wrote**, on the turn it wrote them. The agent then self-corrects without the user having to prompt.

**Goal**: agent edits a file → `aislop` scans the change → agent sees findings in the same turn or the next → agent fixes or explains.

**Success looks like**:
- `aislop init --agents` (or `aislop hook install`) writes the right hook entry and rules file per detected agent, idempotently.
- Agent's `PostToolUse`/`afterFileEdit` equivalent runs `aislop hook <agent>` and surfaces a compact JSON finding list.
- Optional end-of-turn quality gate blocks `Stop` if the score regressed below baseline.
- Uninstall is clean (exact reverse of install, content-hash verified).
- Zero false positives: hook is scoped to files the agent touched this turn.

Non-goals: running full project scans inside the hook (too slow), replacing `aislop ci`, running `aislop fix` automatically.

## 2. Commands

### 2.1 `aislop hook install`

Chosen over `aislop init --agents` as a standalone command. Rationale:

- Install is re-runnable and independent of project `init` (users may install hooks globally before ever running `init` in a repo).
- A user may want to install hooks for one agent, not all. `aislop init` is interactive and project-scoped; hooks cross that boundary.
- `aislop init` remains unchanged. Once `hook install` ships, `init` prints a one-line hint: `Run aislop hook install to wire your coding agent`.

Synopsis:

```
aislop hook install [--agent <name>...] [-g|--global] [--project] [--dry-run] [--yes]
aislop hook uninstall [--agent <name>...] [-g|--global] [--project]
aislop hook status
aislop hook <agent>                   # internal: the hook callback itself
```

Flags:

- `--agent <name>`: one of `claude`, `cursor`, `gemini`, `codex`, `windsurf`, `cline`, `kilocode`, `antigravity`, `copilot`. Repeatable. Default: auto-detect (file-existence check against each agent's config path).
- `-g|--global`: write to the user-scope config (`~/.claude/settings.json`, `~/.cursor/hooks.json`, `~/.gemini/settings.json`, `~/.codex/AGENTS.md`).
- `--project`: write to the project-scope config (`.cursor/hooks.json`, `.gemini/settings.json`, `.clinerules`, `.windsurfrules`, `.kilocode/rules/…`, `.agents/rules/…`, `.github/…`).
- Default when neither is passed: `--project` if a project-scope location is supported for the agent, else `--global`. Per-agent table in §3.
- `--dry-run`: print the planned diff, touch nothing.
- `--yes`: skip the confirmation prompt.

`aislop hook status`: lists, for each agent, whether a hook is installed, where, and whether the installed content matches the current `aislop` version (via the hash sentinel — §6).

### 2.2 `aislop hook <agent>` — the callback

Invoked by the agent's hook runner. Reads JSON from stdin, prints JSON to stdout, exits 0 or 2.

**Universal stdin contract**: each agent sends its own JSON shape. `aislop` normalizes via a per-agent adapter into an internal `HookInput`:

```ts
interface HookInput {
  agent: "claude" | "cursor" | "gemini" | "codex" | ...;
  event: "preToolUse" | "postToolUse" | "afterFileEdit" | "stop" | ...;
  cwd: string;
  toolName?: string;                 // Edit, Write, MultiEdit, write_file, ...
  files: string[];                   // absolute paths the tool touched
  sessionId?: string;
}
```

**Derivation rules per agent**:

| Agent | Stdin source | `files` derived from |
|---|---|---|
| claude | `{tool_name, tool_input: {file_path, edits, content}}` | `tool_input.file_path` (single-file) |
| cursor | `{tool_name, tool_input}` or `afterFileEdit: {file_path, edits}` | `file_path` |
| gemini | `{tool_name, tool_response, tool_input}` | `tool_input.file_path` (for `write_file`/`replace`) |
| codex | n/a — rules-file only | n/a |
| others | n/a — rules-file only | n/a |

If the agent's stdin does not identify the edited file (edge case: multi-file tool output, empty `file_path`), `aislop` falls back to `git diff --name-only` against HEAD to scope the scan. See §8 Open Questions.

**Behavior**: invoke `scanCommand` from `src/commands/scan.ts` with:

```ts
{
  changes: false,          // not git diff
  staged: false,
  verbose: false,
  json: true,
  files: input.files,      // NEW scan option — scoped scan on exact paths
  command: "hook",
}
```

This requires a new `files?: string[]` option on `ScanOptions` (wired through to `engineContext.files`, which is already plumbed). The orchestrator already supports a `files` filter.

**Exit codes**: always `0` in default mode, even when findings exist. Findings are surfaced via the agent's feedback channel (stdout JSON). Exit `2` is reserved for quality-gate mode (§5) and for agent-specific blocking protocols where the agent's contract requires it (Claude Code `PostToolUse` with `decision: "block"` is a stdout field, not an exit code — exit stays `0`).

**Stdout**: per-agent JSON envelope wrapping the universal aislop payload (§4).

### 2.3 `aislop hook uninstall`

Reverses `install`:

- JSON configs: deep-remove only entries whose `command` string contains `aislop hook` AND whose sibling `__aislop` sentinel matches the one written on install. Never delete unrelated hooks.
- Markdown rules files: remove only the content block fenced by aislop sentinels (see §6).
- If a file becomes empty after removal, delete it. Otherwise rewrite atomically.

## 3. Per-agent integration table

Rollout phases: P1 = first release, P2 = second, P3 = rules-file-only last.

| # | Agent | Phase | Hook file | Rules file | Global/Project | What the hook does |
|---|---|---|---|---|---|---|
| 1 | Claude Code | P1 | `~/.claude/settings.json` (g) / `.claude/settings.json` (p) | `~/.claude/AISLOP.md` + `@AISLOP.md` appended to `~/.claude/CLAUDE.md` | both | `PostToolUse` matcher `Edit\|Write\|MultiEdit` → `aislop hook claude`. Optional `Stop` hook for quality gate. |
| 2 | Cursor | P1 | `~/.cursor/hooks.json` (g) / `.cursor/hooks.json` (p) | `.cursor/rules/aislop.mdc` (project only) | both | `afterFileEdit` → `aislop hook cursor`. `postToolUse` as fallback for tool paths that don't emit `afterFileEdit`. |
| 3 | Gemini CLI | P2 | `~/.gemini/settings.json` (g) / `.gemini/settings.json` (p) | `~/.gemini/GEMINI.md` + `@AISLOP.md` | both | `AfterTool` matcher `write_file\|replace` → `aislop hook gemini`. |
| 4 | Codex | P2 | — (no hook support) | `~/.codex/AGENTS.md` (g) / project `AGENTS.md` (p) | both | Rules-file-only. Instructs agent to run `aislop scan --changes --json` after edits. |
| 5 | Windsurf | P3 | — | `.windsurfrules` (project) | project | Rules-file-only. |
| 6 | Cline / Roo | P3 | — | `.clinerules` (project), `.roo/rules/aislop.md` (Roo) | project | Rules-file-only. |
| 7 | Kilo Code | P3 | — | `.kilocode/rules/aislop-rules.md` | project | Rules-file-only. |
| 8 | Antigravity | P3 | — | `.agents/rules/antigravity-aislop-rules.md` | project | Rules-file-only. |
| 9 | Copilot (VS Code) | P3 | `.github/copilot-instructions.md` and `.vscode/settings.json` (for agent-hooks preview) | same | project | Rules-file for stable Copilot, agent-hook entry for Copilot Agent Mode where supported. |

### 3.1 Claude Code hook snippet

Deep-merged into `hooks.PostToolUse[]`:

```json
{
  "matcher": "Edit|Write|MultiEdit",
  "hooks": [
    {
      "type": "command",
      "command": "aislop hook claude",
      "__aislop": { "v": 1, "managed": true }
    }
  ]
}
```

Matcher `Edit|Write|MultiEdit` is the pipe-separated exact-name form (documented: only letters/digits/`_`/`|` = exact match list). Per Claude Code hook docs, `PostToolUse` stdin is:

```json
{
  "hook_event_name": "PostToolUse",
  "tool_name": "Edit",
  "tool_input": { "file_path": "/abs/path.ts", "old_string": "...", "new_string": "..." },
  "tool_response": { ... },
  "cwd": "/abs/project",
  "session_id": "..."
}
```

Response (aislop's stdout):

```json
{
  "decision": "block",                          // only if quality gate + regression
  "reason": "aislop: 2 new issues introduced",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "<stringified AislopFeedback — §4>"
  }
}
```

In default (non-blocking) mode, `decision` is omitted and only `additionalContext` is populated. Claude surfaces `additionalContext` to the model on the next turn.

### 3.2 Cursor hook snippet

`~/.cursor/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "afterFileEdit": [
      {
        "command": "aislop hook cursor",
        "type": "command",
        "timeout": 5000,
        "__aislop": { "v": 1, "managed": true }
      }
    ]
  }
}
```

Cursor `afterFileEdit` stdin: `{ file_path, edits: [{ old_string, new_string }] }` plus universal fields. Cursor `afterFileEdit` output per docs is observational (no schema); aislop prints its payload on stdout as `additional_context` wrapped in a `postToolUse`-compatible envelope where possible, and falls back to stderr (which Cursor surfaces to the agent). Confirm in implementation — see §8.

### 3.3 Gemini CLI hook snippet

`~/.gemini/settings.json`:

```json
{
  "hooks": {
    "AfterTool": [
      {
        "matcher": "write_file|replace",
        "hooks": [
          {
            "name": "aislop",
            "type": "command",
            "command": "aislop hook gemini",
            "timeout": 5000
          }
        ]
      }
    ]
  }
}
```

Gemini stdin includes `tool_response` post-execution. Output schema supports `systemMessage` and `hookSpecificOutput.additionalContext` — aislop uses the latter.

### 3.4 Rules-file content (AISLOP.md)

One canonical file shipped in `src/assets/AISLOP.md`, rendered per agent with minor header variation. Core body:

```md
<!-- aislop:begin v1 -->
# aislop — agent instructions

This project uses `aislop` (https://github.com/heavykenny/aislop) to catch AI-authored code patterns (dead imports, `as any`, narrative comments, swallowed errors, oversized functions).

## On every edit to this repo

1. After you finish a batch of edits, run:
   `aislop scan --changes --json`
2. Parse the `diagnostics[]` array. For each item with `severity: "error"` or `fixable: true`, fix it before handing back to the user.
3. Do NOT disable rules to pass the scan. Fix the underlying issue.
4. If a finding is a false positive, leave it and explain in your reply — do not delete the rule config.

## Severity ladder

- `error` — must fix this turn.
- `warning` + `fixable: true` — fix this turn.
- `warning` + `fixable: false` — fix if trivially mechanical, otherwise surface in your reply.

## Config

- `.aislop/config.yaml` — thresholds and engine toggles. Don't edit without user consent.
- Architecture rules in `.aislop/rules.yaml`. Respect them.
<!-- aislop:end v1 -->
```

## 4. Feedback contract

`aislop hook <agent>` emits a compact feedback payload. Shape is agent-agnostic; per-agent adapters wrap it in the envelope each agent expects (`additionalContext`, stderr, etc.).

```ts
interface AislopFeedback {
  schema: "aislop.hook.v1";
  score: number;                      // 0-100, scoped to hooked files
  baseline?: number;                  // if baseline.json exists
  regressed: boolean;                 // score < baseline
  counts: {
    error: number;
    warning: number;
    fixable: number;
    total: number;
  };
  findings: Finding[];                // capped at 20; rest summarized
  elided?: number;                    // count omitted past cap
  nextSteps: string[];                // imperative, 1-line each
}

interface Finding {
  ruleId: string;                     // e.g. "ai-slop/narrative-comment"
  severity: "error" | "warning";
  category: "format" | "lint" | "code-quality" | "ai-slop" | "architecture" | "security";
  file: string;                       // repo-relative
  line: number;
  col?: number;
  message: string;                    // single sentence, imperative
  fix?: {
    kind: "replace" | "delete-line" | "delete-range" | "insert";
    old?: string;
    new?: string;
    range?: { startLine: number; endLine: number };
  };
}
```

**Example stdout** (Claude Code envelope):

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "{\"schema\":\"aislop.hook.v1\",\"score\":82,\"regressed\":false,\"counts\":{\"error\":0,\"warning\":2,\"fixable\":1,\"total\":2},\"findings\":[{\"ruleId\":\"ai-slop/narrative-comment\",\"severity\":\"warning\",\"category\":\"ai-slop\",\"file\":\"src/api/users.ts\",\"line\":12,\"message\":\"Delete the narrative comment — it restates the code below.\",\"fix\":{\"kind\":\"delete-range\",\"range\":{\"startLine\":11,\"endLine\":14}}},{\"ruleId\":\"ai-slop/as-any-cast\",\"severity\":\"warning\",\"category\":\"ai-slop\",\"file\":\"src/api/users.ts\",\"line\":37,\"message\":\"Replace the `as any` cast with a proper type.\"}],\"nextSteps\":[\"Apply the delete-range fix on src/api/users.ts:11-14\",\"Add a User type instead of the as-any cast on line 37\"]}"
  }
}
```

**Rationale for stringified `additionalContext`**: Claude Code expects `additionalContext` to be a string. Keeping the JSON stringified lets the model parse it deterministically without fighting escaping.

**Cap**: 20 findings max. Beyond that, agents get decision fatigue. `elided` signals the agent to run `aislop scan --json` itself for the full list.

## 5. Quality-gate mode

Opt-in via install flag:

```
aislop hook install --agent claude --quality-gate
```

or via `.aislop/config.yaml`:

```yaml
hooks:
  qualityGate:
    enabled: true
    regressTolerance: 0        # block if score drops by >0 vs baseline
    stopEvent: true            # install a Stop/afterAgentResponse hook
```

### Baseline storage

`.aislop/baseline.json`:

```json
{
  "schema": "aislop.baseline.v1",
  "updatedAt": "2026-04-18T10:15:00Z",
  "score": 87,
  "byEngine": { "format": 100, "lint": 95, "code-quality": 80, "ai-slop": 78, "architecture": 100, "security": 100 },
  "fileCount": 142,
  "commit": "abc123"           // HEAD at time of baseline
}
```

Baseline is (re)captured by `aislop hook baseline` (manual) or on the first post-install scan that shows no errors. The `Stop` hook in quality-gate mode:

1. Runs `aislop scan --json` against the full changed set of the session (reconstructed from hook history written to `.aislop/session.jsonl` — each `PostToolUse` invocation appends the file list).
2. Compares to `baseline.json`.
3. If `score < baseline.score - regressTolerance`, emits:

   ```json
   { "decision": "block", "reason": "aislop: score dropped from 87 to 79. Fix the 3 new findings before finishing." }
   ```

4. Claude Code treats `Stop` `decision: "block"` as "don't stop" — the model keeps working.

Analogous handling for Cursor `stop` (output `followup_message`), Gemini (block via exit 2). Agents without a stop event (P3 rules-only) skip quality-gate mode.

## 6. Idempotency & safety

Mirrors RTK's file-write discipline:

- **Content hash sentinel**: every `aislop`-managed block/file stores a `SHA-256` of the canonical template content under a sentinel key:
  - JSON: `"__aislop": { "v": 1, "managed": true, "hash": "sha256:..." }`.
  - Markdown: HTML comment block `<!-- aislop:begin v1 hash=sha256:... -->` … `<!-- aislop:end v1 -->`.
- **Write protocol**:
  1. Compute canonical content → hash.
  2. Read target file.
  3. If hash matches stored hash → no-op (idempotent re-run).
  4. If sentinel exists but hash differs → replace the bounded region only.
  5. If no sentinel → deep-merge (JSON) or append (markdown) with fresh sentinel.
  6. Write to `target.tmp.<rand>` in same directory → `fs.renameSync(tmp, target)` (atomic on same filesystem).
  7. Preserve file permissions and surrounding unknown keys.
- **Never clobber unrelated hooks**: JSON deep-merge operates on arrays by filtering out only entries with `__aislop` sentinel, then appending aislop's entry. Other hooks are untouched.
- **Rollback on uninstall**: remove only aislop-sentineled entries. If a parent array becomes empty, remove the array. If a parent object becomes empty, remove it. Never prune keys the user wrote.
- **Backup before write**: copy `target` → `target.aislop-bak` if the file existed and has no sentinel (first write). Document this in `hook status`.

## 7. Rollout order

1. **P1 — Claude Code**. MVP. `PostToolUse` + `AISLOP.md` + `settings.json` deep-merge. This is the reference agent; all later adapters conform to the same universal `HookInput` shape.
2. **P1 — Cursor**. `afterFileEdit` + `.cursor/hooks.json`. Validates the universal adapter is actually universal.
3. **P2 — Gemini CLI**. `AfterTool` matcher + `.gemini/settings.json`.
4. **P2 — Codex**. Rules-file-only. Low effort; proves the no-hook path.
5. **P3 — Windsurf, Cline/Roo, Kilo Code, Antigravity, Copilot**. Rules-file-only, batched. Single PR.

Each phase ships with:
- Adapter in `src/hooks/adapters/<agent>.ts`.
- Install/uninstall coverage in `src/hooks/install/<agent>.ts`.
- Snapshot tests asserting idempotent write + exact uninstall.
- README entry + docs.

## 8. Open questions

1. **Exit-code vs stdout for "agent must address this"**. Plan: exit `0` + stdout JSON in default mode; exit `2` only in quality-gate mode where the agent's contract (Claude `Stop`) requires `decision: "block"` which is stdout-based, not exit-based. Gemini `AfterTool` does use exit `2` as a hard block. Needs per-agent verification during P1/P2 implementation — specifically whether Claude's `PostToolUse` `decision: "block"` feeds into the next turn reliably or gets dropped.
2. **File scoping for multi-file edits**. Claude's `MultiEdit` passes a single `file_path` so this is fine. But Gemini's `replace` may affect multiple files in one call; Cursor's `afterFileEdit` fires per file. For any stdin that lacks a clear file list, fall back to `git diff --name-only HEAD` scoped to `cwd`. If there's no git repo, scan nothing and exit 0. Confirm Cursor fires `afterFileEdit` once per file or once per batch — spec assumes per file.
3. **Cursor `afterFileEdit` output channel**. Docs say this hook is observational (no documented `additional_context` field). Options: (a) write to stderr — Cursor routes stderr to the agent; (b) use `postToolUse` instead of `afterFileEdit` so we can return `additional_context`. TBD after P1 implementation testing.
4. **Copilot agent-hooks**. VS Code's agent-hooks feature is still preview. The spec lists `.vscode/settings.json` tentatively; final path depends on GA form. Treat Copilot as rules-file-only until the hooks API stabilizes.
5. **Baseline drift**. If the user commits improvements, baseline should auto-advance. Proposed: `aislop hook baseline --auto` invoked from a `git post-commit` hook — but that leaks outside the scope of this spec. Track as a follow-up.
6. **`--changed-only` from hook stdin vs git diff**. Claude/Cursor/Gemini all pass the edited `file_path` directly in stdin; use that. Git diff is only a fallback (see #2). The `scan --changed-only` flag is not reused here — hook mode uses the new `files[]` option.
7. **Performance budget**. Claude docs suggest hook timeouts default to 60s; Cursor/Gemini 5s. A full `aislop scan` on a big repo can exceed 5s. Mitigation: hook always runs scoped (`files[]`) so it's fast. If scoped scan still exceeds budget, skip non-essential engines (`security` audits hit the network — must be off in hook mode by default).
8. **Self-scan safety**. aislop scans itself. When the hook runs `aislop` from within an aislop-repo edit, avoid infinite recursion (aislop's own agent editing aislop, hook re-invokes aislop). Lock file `.aislop/hook.lock` with PID + timestamp, skipped if stale > 30s.

---

## Appendix A — file inventory

```
src/
  commands/
    hook.ts                         # new: dispatch install/uninstall/status/<agent>
  hooks/
    adapters/
      claude.ts                     # stdin → HookInput, HookOutput → stdout envelope
      cursor.ts
      gemini.ts
    install/
      claude.ts                     # settings.json deep-merge + AISLOP.md
      cursor.ts
      gemini.ts
      codex.ts                      # rules-only
      windsurf.ts
      cline.ts
      kilocode.ts
      antigravity.ts
      copilot.ts
    io/
      json-patch.ts                 # deep-merge with sentinel awareness
      atomic-write.ts               # tempfile + rename
      sentinel.ts                   # hash compute/compare, fence parsing
    feedback.ts                     # AislopFeedback builder
    baseline.ts                     # read/write .aislop/baseline.json
  assets/
    AISLOP.md                       # canonical rules template
src/cli.ts                          # register `hook` subcommand
tests/hooks/                        # snapshot tests per agent
docs/specs/agent-hooks.md           # this file
```

## Appendix B — install dry-run example

```
$ aislop hook install --agent claude --dry-run

aislop 0.6.0 · hook install (dry-run)

 [would write]  ~/.claude/settings.json
   + hooks.PostToolUse[] += { matcher: "Edit|Write|MultiEdit", hooks: [{ command: "aislop hook claude" }] }
   sentinel: sha256:c9f2…4a1b

 [would write]  ~/.claude/AISLOP.md
   + new file, 38 lines
   sentinel: sha256:a71e…0c02

 [would patch]  ~/.claude/CLAUDE.md
   + append line: @AISLOP.md

No files touched. Re-run without --dry-run to apply.
```

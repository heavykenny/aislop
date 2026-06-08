# aislop agent — alt-screen TUI redesign

_Date: 2026-06-07. Status: approved design, ready for implementation plan._

## 1. Goal

Replace the `aislop agent` streamed output with a polished, OpenCode-style alt-screen TUI: a main activity pane + a live sidebar + a footer status bar, updating in place during the run. Eliminate the current repetition and surface the key information that's missing.

### Non-goals
- No change to what the agent *does* (worktree, provider orchestration, scanning, publish). Presentation only.
- No MCP/LSP sidebar rows (those belong to the underlying provider, not aislop).
- No full pricing catalog — cost/context% are best-effort for known models only.

## 2. Current state and the problems

`runAgentSession` (`src/commands/agent-session.ts`) prints directly to stdout via `@clack/prompts` blocks. Each **checkpoint** and the final **summary** each re-print the full score/tokens/files block, and three overlapping file lists appear (Recent edits / Changed files / File activity). Interactive decision points use clack `select()` mid-run (`agent-session-steps.ts`).

Problems (from the user): heavy repetition, missing key info (cost, context %, clear score→target progress, elapsed), and no live TUI feel.

## 3. Architecture: one state store, two renderers

The repetition is structural: the loop *prints* instead of updating a model. Invert it.

```
 run loop (producer) ──updates──▶ AgentSessionState (observable store)
                                        │ subscribe
                          ┌─────────────┴──────────────┐
                          ▼                             ▼
              <AgentApp> (Ink, TTY only)      PlainReporter (non-TTY/CI)
              alt-screen main+sidebar+footer  clean streamed deltas
```

One source of truth ⇒ no duplicate blocks by construction. The store also decouples *asking a decision* from *rendering it*.

## 4. Data model

`src/agents/session-state.ts` (new):

```ts
interface AgentSessionState {
  provider: string;            // "Codex"
  model: string | null;        // resolved model id when known
  providerSource: string;      // "auto-detect installed provider"
  scoreStart: number | null;
  score: number | null;
  targetScore: number;
  findingsRemaining: number | null;
  filesChanged: Set<string>;   // dedupes the old 3 lists
  filesEdited: Set<string>;
  passes: number;
  toolCalls: number;
  tokens: { in: number; out: number; cached: number; total: number };
  startedAt: number;           // performance.now()
  worktree: string | null;
  targetRepo: string;
  branch: string | null;
  activity: ActivityLine[];    // ring buffer, cap ~200
  recentEdits: EditEntry[];    // cap ~8 (file, time, "git diff")
  phase: "starting" | "running" | "awaiting-decision" | "publishing" | "done" | "error";
  pendingDecision: PendingDecision | null;
  summary: SessionSummary | null;
}

interface ActivityLine { kind: "assistant" | "tool" | "exec" | "event"; text: string; at: number }
interface PendingDecision { question: string; options: { value: string; label: string; hint?: string }[]; resolve: (v: string) => void }
```

Derived (not stored): `cost = pricing(provider, model, tokens)`, `contextPct = tokens.total / contextWindow(provider, model)` — both null when the model is unknown.

### Store API
`createSessionState(init)` returns:
- `getState()`, `subscribe(fn): unsubscribe`
- `update(patch | (s)=>patch)`, `pushActivity(line)`, `recordEdit(file)`, `addTokens(delta)`, `incPass()`
- `askDecision(question, options): Promise<string>` — sets `pendingDecision` with a `resolve`, returns the promise; a renderer resolves it.
- `finish(summary)` — sets phase `done` + summary.

## 5. Renderers

### 5a. Ink TUI (`src/ui/agent-tui/`, TTY only)
- `mount.ts` — lazy `import('ink')` + `import('react')`; enter alt-screen (`\x1b[?1049h`), `render(<AgentApp store=… />)`, return a handle with `unmount()` that restores the screen (`\x1b[?1049l`).
- `AgentApp.tsx` — subscribes to the store via a `useSyncExternalStore`-style hook; layout:
  - `Box flexDirection=column height={rows}`
    - `Box flexGrow=1`: `<ActivityPane/>` (flexGrow 1) + `<Sidebar width=30/>`
    - `<DecisionBar/>` when `pendingDecision` (Ink `SelectInput`, resolves the promise)
    - `<FooterBar/>` (cwd · branch · worktree · key hints)
- `Sidebar.tsx` rows: provider/model · score→target (themed color) · findings left · files changed · passes · tokens (in/out/cached) · cost (hide if null) · ctx% (hide if null) · elapsed.
- `ActivityPane.tsx` — tails the last N activity lines that fit; `assistant/tool/exec` styled.
- Color: map existing theme tokens → Ink colors (success/warn/danger/muted/accent).

### 5b. PlainReporter (`src/agents/plain-reporter.ts`, non-TTY/CI/`--background`/`--json`)
Subscribes to the same store, prints clean streamed **deltas**:
- Header once: `aislop agent · <provider> (<source>) · target N/100`, then `worktree …`, `transcript …`.
- Per pass: one line `pass N  <start>→<score> · <left> left · <files> files · <tools> tools · <tok> tok[ · $cost]` then `  ↳ edited a.ts, b.ts, +K more`.
- Decisions: fall back to existing clack `select()`.
- Finish: ONE canonical summary — score start→end, passes, single changed-files list (+K more), `Review aislop agent show <id>`, `Apply aislop agent apply <id>`.

## 6. Decision routing
At a decision point the loop calls `await store.askDecision(question, options)`. In TUI mode `DecisionBar` renders the options and calls `resolve` on select. In plain mode the PlainReporter calls clack `select()` and resolves. The loop is identical in both modes.

## 7. pricing.ts (new)
`(providerId, modelId | null) → { inPerMTok, outPerMTok, contextWindow } | null`. A small table for the default models of Codex / Claude / OpenCode, keyed by model id with a provider→default-model fallback. `computeCost(entry, tokens)` and `contextPct(entry, tokens)` return null on miss so the sidebar rows hide. Header comment: prices/models drift — update as needed.

## 8. TTY gating
Use the Ink TUI when `process.stdout.isTTY && !options.background && !options.json && !process.env.CI`. Otherwise PlainReporter. Background mode and transcript writing are unchanged.

## 9. Files

**New**
- `src/agents/session-state.ts` — store + types.
- `src/agents/pricing.ts` — pricing/context table + helpers.
- `src/agents/plain-reporter.ts` — non-TTY streamed renderer.
- `src/ui/agent-tui/{AgentApp,Sidebar,ActivityPane,DecisionBar,FooterBar}.tsx` + `mount.ts`.

**Changed**
- `src/commands/agent-session.ts` — build the store, choose renderer, route activity/tokens/edits/decisions through it (remove direct block printing).
- `src/commands/agent-session-steps.ts` — decisions go through `store.askDecision`.
- `tsconfig.json` — add `"jsx": "react-jsx"`, `"jsxImportSource": "react"`.
- `package.json` — add `ink`, `react`, `ink-select-input` (+ `@types/react`). Lazy-imported in `mount.ts` so `scan`/other commands' cold-start is unaffected.

## 10. Safety
- `try/finally` around the run: always `unmount()` + restore the main screen, even on throw or SIGINT (no leaked alt-screen).
- The `.jsonl` transcript is written exactly as today; the TUI is presentation-only.

## 11. Testing
- `session-state.test.ts` — update/subscribe, `askDecision` resolves, Set dedupe, ring-buffer cap.
- `pricing.test.ts` — known model → cost/ctx; unknown → null.
- `plain-reporter.test.ts` — feed a scripted state sequence, assert exact streamed output: deltas only, no repetition, one summary.
- `agent-tui/*.test.tsx` — `ink-testing-library` renders `Sidebar`/`ActivityPane`/`DecisionBar` for a fixed state → snapshot; assert cost/ctx rows hide when null.
- All existing agent tests continue to pass.

## 12. Acceptance criteria
1. No repeated token/file blocks; checkpoints are deltas; exactly one canonical changed-files list.
2. TTY: alt-screen TUI with main + sidebar + footer; updates in place; clean exit (screen restored) on completion and on ctrl-c.
3. Non-TTY/CI/background/json: clean streamed output with the same data, pipe-safe.
4. Cost and context% appear only when the model is known, hidden otherwise.
5. `scan` and other commands' startup time is unchanged (Ink lazy-loaded).
6. New unit/snapshot tests pass; existing suite stays green.

## 13. Risks
- New deps (react+ink) — mitigated by lazy, agent-only import.
- Ink JSX in the build — tsdown (Rolldown/oxc) transforms JSX; needs tsconfig `jsx`.
- Terminal compatibility — Ink covers most; non-TTY fallback covers the rest.
- ~2-day effort across the rewrite.

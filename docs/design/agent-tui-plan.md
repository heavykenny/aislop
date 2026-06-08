# aislop agent TUI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the `aislop agent` streamed output with an Ink alt-screen TUI (main pane + sidebar + footer) backed by a single state store, with a clean streamed fallback for non-TTY.

**Architecture:** One observable `AgentSessionState` store is the single source of truth. The run loop updates it; an Ink `<AgentApp>` renders it in TTY mode, a `PlainReporter` streams deltas in non-TTY/CI mode. Decisions are routed through `store.askDecision()` so the loop is render-agnostic. Cost/context% come from a small best-effort pricing table.

**Tech Stack:** TypeScript (ESM), Ink 5 + React 18 (lazy-loaded, agent-only), `ink-select-input`, `ink-testing-library`, Vitest, tsdown.

**Phasing for parallel-edit safety:** Phases 1-3 create NEW files only (no conflict with in-flight edits to `agent-session.ts`/`summary.ts`). Phase 4 (deps/build) is config-only. Phase 5 (integration) is the ONLY phase that edits `agent-session.ts`/`agent-session-steps.ts` — do it last, coordinated.

---

## File structure

**New**
- `src/agents/pricing.ts` — `(provider, model) → {inPerMTok, outPerMTok, contextWindow} | null`; `computeCostUsd`, `contextPct`.
- `src/agents/session-state.ts` — store: state type + `createSessionState()` with `getState/subscribe/update/pushActivity/recordEdit/addTokens/incPass/askDecision/finish`.
- `src/agents/plain-reporter.ts` — subscribes to the store, streams header + per-pass deltas + one summary.
- `src/ui/agent-tui/format.ts` — pure formatters shared by Ink + plain (tokens `679k`, elapsed `1m04s`, file-list `a, b, +K more`).
- `src/ui/agent-tui/AgentApp.tsx`, `Sidebar.tsx`, `ActivityPane.tsx`, `DecisionBar.tsx`, `FooterBar.tsx`, `useStore.ts`, `mount.ts`.

**Modified (Phase 5 only)**
- `src/commands/agent-session.ts` — build store, pick renderer, feed events.
- `src/commands/agent-session-steps.ts` — decisions via `store.askDecision`.
- `tsconfig.json`, `package.json`.

---

## Phase 1 — pricing (pure, no deps)

### Task 1: pricing table + helpers

**Files:** Create `src/agents/pricing.ts`; Test `tests/agents/pricing.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, expect, it } from "vitest";
import { computeCostUsd, contextPct, resolvePricing } from "../../src/agents/pricing.js";

describe("pricing", () => {
  it("resolves a known model by id", () => {
    const p = resolvePricing("codex", "gpt-5.4");
    expect(p?.contextWindow).toBeGreaterThan(0);
  });
  it("falls back to a provider default model", () => {
    expect(resolvePricing("claude", null)).not.toBeNull();
  });
  it("returns null for an unknown provider/model", () => {
    expect(resolvePricing("mystery", "who-knows")).toBeNull();
  });
  it("computes cost from tokens", () => {
    const p = resolvePricing("codex", "gpt-5.4")!;
    const cost = computeCostUsd(p, { in: 1_000_000, out: 1_000_000, cached: 0, total: 2_000_000 });
    expect(cost).toBeCloseTo(p.inPerMTok + p.outPerMTok, 5);
  });
  it("computes context percent", () => {
    const p = resolvePricing("codex", "gpt-5.4")!;
    const pct = contextPct(p, { in: 0, out: 0, cached: 0, total: p.contextWindow / 2 });
    expect(pct).toBeCloseTo(50, 1);
  });
  it("hides cost/ctx when pricing is null", () => {
    expect(computeCostUsd(null, { in: 1, out: 1, cached: 0, total: 2 })).toBeNull();
    expect(contextPct(null, { in: 0, out: 0, cached: 0, total: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify FAIL** — `npx vitest run tests/agents/pricing.test.ts` → fails (module missing).

- [ ] **Step 3: Implement**
```ts
export interface TokenUsage { in: number; out: number; cached: number; total: number }
export interface Pricing { model: string; inPerMTok: number; outPerMTok: number; contextWindow: number }

// Best-effort defaults. Prices/models drift — update as needed; unknowns hide cost/ctx rows.
const MODELS: Record<string, Pricing> = {
  "gpt-5.4": { model: "gpt-5.4", inPerMTok: 1.25, outPerMTok: 10, contextWindow: 400_000 },
  "claude-opus-4-8": { model: "claude-opus-4-8", inPerMTok: 5, outPerMTok: 25, contextWindow: 200_000 },
  "claude-sonnet-4-6": { model: "claude-sonnet-4-6", inPerMTok: 3, outPerMTok: 15, contextWindow: 200_000 },
};
const PROVIDER_DEFAULT: Record<string, string> = {
  codex: "gpt-5.4",
  claude: "claude-opus-4-8",
  opencode: "claude-sonnet-4-6",
};

export const resolvePricing = (provider: string, model: string | null): Pricing | null => {
  if (model && MODELS[model]) return MODELS[model];
  const fallback = PROVIDER_DEFAULT[provider.toLowerCase()];
  return fallback ? (MODELS[fallback] ?? null) : null;
};

export const computeCostUsd = (p: Pricing | null, t: TokenUsage): number | null => {
  if (!p) return null;
  return (t.in / 1_000_000) * p.inPerMTok + (t.out / 1_000_000) * p.outPerMTok;
};

export const contextPct = (p: Pricing | null, t: TokenUsage): number | null => {
  if (!p || p.contextWindow <= 0) return null;
  return (t.total / p.contextWindow) * 100;
};
```

- [ ] **Step 4: Run, verify PASS** — `npx vitest run tests/agents/pricing.test.ts`.
- [ ] **Step 5: Commit** — `git add src/agents/pricing.ts tests/agents/pricing.test.ts && git commit -m "feat(agent): pricing/context helpers for TUI sidebar"`

---

## Phase 2 — formatters (pure)

### Task 2: shared formatters

**Files:** Create `src/ui/agent-tui/format.ts`; Test `tests/ui/agent-tui/format.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, expect, it } from "vitest";
import { fmtTokens, fmtElapsed, fmtFileList } from "../../../src/ui/agent-tui/format.js";

describe("format", () => {
  it("abbreviates tokens", () => { expect(fmtTokens(678_962)).toBe("679k"); expect(fmtTokens(900)).toBe("900"); });
  it("formats elapsed", () => { expect(fmtElapsed(64_000)).toBe("1m04s"); expect(fmtElapsed(9_000)).toBe("9s"); });
  it("summarizes a file list with overflow", () => {
    expect(fmtFileList(["a.ts","b.ts","c.ts"], 2)).toBe("a.ts, b.ts, +1 more");
    expect(fmtFileList(["a.ts"], 2)).toBe("a.ts");
  });
});
```
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement**
```ts
export const fmtTokens = (n: number): string =>
  n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

export const fmtElapsed = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(s % 60).padStart(2, "0")}s`;
};

export const fmtFileList = (files: string[], max: number): string => {
  if (files.length <= max) return files.join(", ");
  return `${files.slice(0, max).join(", ")}, +${files.length - max} more`;
};
```
- [ ] **Step 4: Verify PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): shared TUI formatters"`

---

## Phase 3 — state store + plain reporter

### Task 3: AgentSessionState store

**Files:** Create `src/agents/session-state.ts`; Test `tests/agents/session-state.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, expect, it, vi } from "vitest";
import { createSessionState } from "../../src/agents/session-state.js";

const base = { provider: "Codex", providerSource: "auto", targetScore: 90, targetRepo: "/repo" };

describe("session state", () => {
  it("notifies subscribers on update", () => {
    const store = createSessionState(base);
    const fn = vi.fn();
    store.subscribe(fn);
    store.update({ score: 24 });
    expect(fn).toHaveBeenCalled();
    expect(store.getState().score).toBe(24);
  });
  it("dedupes changed files", () => {
    const store = createSessionState(base);
    store.recordEdit("a.ts"); store.recordEdit("a.ts"); store.recordEdit("b.ts");
    expect(store.getState().filesChanged.size).toBe(2);
  });
  it("caps the activity ring buffer", () => {
    const store = createSessionState(base);
    for (let i = 0; i < 300; i++) store.pushActivity({ kind: "tool", text: `t${i}`, at: i });
    expect(store.getState().activity.length).toBeLessThanOrEqual(200);
  });
  it("resolves askDecision when a renderer answers", async () => {
    const store = createSessionState(base);
    const p = store.askDecision("Next?", [{ value: "stop", label: "Stop" }]);
    expect(store.getState().pendingDecision?.question).toBe("Next?");
    store.getState().pendingDecision!.resolve("stop");
    expect(await p).toBe("stop");
    expect(store.getState().pendingDecision).toBeNull();
  });
});
```
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement**
```ts
import type { TokenUsage } from "./pricing.js";

export interface ActivityLine { kind: "assistant" | "tool" | "exec" | "event"; text: string; at: number }
export interface EditEntry { file: string; at: number }
export interface PendingDecision {
  question: string;
  options: { value: string; label: string; hint?: string }[];
  resolve: (value: string) => void;
}
export interface SessionSummary {
  scoreStart: number | null; score: number | null; passes: number;
  findingsRemaining: number | null; changedFiles: string[];
  worktree: string | null; sessionId: string | null;
}
export interface AgentSessionState {
  provider: string; model: string | null; providerSource: string;
  scoreStart: number | null; score: number | null; targetScore: number;
  findingsRemaining: number | null;
  filesChanged: Set<string>; filesEdited: Set<string>;
  passes: number; toolCalls: number; tokens: TokenUsage;
  startedAt: number; worktree: string | null; targetRepo: string; branch: string | null;
  activity: ActivityLine[]; recentEdits: EditEntry[];
  phase: "starting" | "running" | "awaiting-decision" | "publishing" | "done" | "error";
  pendingDecision: PendingDecision | null; summary: SessionSummary | null;
}

const ACTIVITY_CAP = 200;
const EDITS_CAP = 8;

export interface SessionStore {
  getState(): AgentSessionState;
  subscribe(fn: () => void): () => void;
  update(patch: Partial<AgentSessionState> | ((s: AgentSessionState) => Partial<AgentSessionState>)): void;
  pushActivity(line: ActivityLine): void;
  recordEdit(file: string, at?: number): void;
  addTokens(delta: Partial<TokenUsage>): void;
  incPass(): void;
  askDecision(question: string, options: PendingDecision["options"]): Promise<string>;
  finish(summary: SessionSummary): void;
}

export const createSessionState = (
  init: Pick<AgentSessionState, "provider" | "providerSource" | "targetScore" | "targetRepo"> &
    Partial<AgentSessionState>,
): SessionStore => {
  const state: AgentSessionState = {
    model: null, scoreStart: null, score: null, findingsRemaining: null,
    filesChanged: new Set(), filesEdited: new Set(), passes: 0, toolCalls: 0,
    tokens: { in: 0, out: 0, cached: 0, total: 0 }, startedAt: Date.now(),
    worktree: null, branch: null, activity: [], recentEdits: [],
    phase: "starting", pendingDecision: null, summary: null,
    ...init,
  };
  const subs = new Set<() => void>();
  const emit = () => { for (const fn of subs) fn(); };
  return {
    getState: () => state,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    update(patch) { Object.assign(state, typeof patch === "function" ? patch(state) : patch); emit(); },
    pushActivity(line) {
      state.activity.push(line);
      if (state.activity.length > ACTIVITY_CAP) state.activity.splice(0, state.activity.length - ACTIVITY_CAP);
      emit();
    },
    recordEdit(file, at = Date.now()) {
      state.filesChanged.add(file); state.filesEdited.add(file);
      state.recentEdits.push({ file, at });
      if (state.recentEdits.length > EDITS_CAP) state.recentEdits.splice(0, state.recentEdits.length - EDITS_CAP);
      emit();
    },
    addTokens(delta) {
      const t = state.tokens;
      state.tokens = {
        in: t.in + (delta.in ?? 0), out: t.out + (delta.out ?? 0),
        cached: t.cached + (delta.cached ?? 0), total: t.total + (delta.total ?? 0),
      };
      emit();
    },
    incPass() { state.passes += 1; emit(); },
    askDecision(question, options) {
      return new Promise<string>((resolve) => {
        state.pendingDecision = {
          question, options,
          resolve: (value) => { state.pendingDecision = null; state.phase = "running"; emit(); resolve(value); },
        };
        state.phase = "awaiting-decision"; emit();
      });
    },
    finish(summary) { state.summary = summary; state.phase = "done"; emit(); },
  };
};
```
- [ ] **Step 4: Verify PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): observable session-state store"`

### Task 4: PlainReporter (non-TTY)

**Files:** Create `src/agents/plain-reporter.ts`; Test `tests/agents/plain-reporter.test.ts`

- [ ] **Step 1: Failing test** — drive the store through a scripted run, capture `write` calls, assert: header once, one delta line per pass, single summary, no repeated token block.
```ts
import { describe, expect, it, vi } from "vitest";
import { createSessionState } from "../../src/agents/session-state.js";
import { attachPlainReporter } from "../../src/agents/plain-reporter.js";

it("streams a header, per-pass deltas, and one summary", () => {
  const writes: string[] = [];
  const store = createSessionState({ provider: "Codex", providerSource: "auto", targetScore: 90, targetRepo: "/repo", worktree: "/wt" });
  attachPlainReporter(store, { write: (s) => writes.push(s) });
  store.update({ scoreStart: 14, score: 24, findingsRemaining: 51 });
  store.recordEdit("a.ts"); store.recordEdit("b.ts");
  store.incPass();
  store.finish({ scoreStart: 14, score: 24, passes: 1, findingsRemaining: 51, changedFiles: ["a.ts", "b.ts"], worktree: "/wt", sessionId: "2680" });
  const out = writes.join("");
  expect(out).toContain("aislop agent · Codex");
  expect(out.match(/pass 1/g)?.length).toBe(1);
  expect(out.match(/Summary/g)?.length).toBe(1);
  expect(out).toContain("aislop agent apply 2680");
});
```
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement** — subscribe; on first emit print the header; on `incPass`-driven pass change print one delta line; on `phase==="done"` print the summary once; defer decisions to the caller (clack). Use `fmtTokens/fmtFileList` from `format.ts` and `computeCostUsd`.
```ts
import { computeCostUsd, resolvePricing } from "./pricing.js";
import type { SessionStore } from "./session-state.js";
import { fmtFileList, fmtTokens } from "../ui/agent-tui/format.js";

interface Sink { write(s: string): void }

export const attachPlainReporter = (store: SessionStore, sink: Sink = process.stdout): (() => void) => {
  let headerPrinted = false;
  let lastPass = 0;
  let summaryPrinted = false;
  const unsub = store.subscribe(() => {
    const s = store.getState();
    if (!headerPrinted) {
      headerPrinted = true;
      sink.write(` aislop agent · ${s.provider} (${s.providerSource}) · target ${s.targetScore}/100\n`);
      if (s.worktree) sink.write(`   worktree ${s.worktree}\n`);
      sink.write("\n");
    }
    if (s.passes > lastPass) {
      lastPass = s.passes;
      const cost = computeCostUsd(resolvePricing(s.provider, s.model), s.tokens);
      const costStr = cost == null ? "" : ` · $${cost.toFixed(2)}`;
      const start = s.scoreStart ?? "?";
      sink.write(
        ` pass ${s.passes}  ${start}→${s.score ?? "?"} · ${s.findingsRemaining ?? "?"} left · ` +
          `${s.filesChanged.size} files · ${fmtTokens(s.tokens.total)} tok${costStr}\n`,
      );
      const edits = [...s.filesChanged];
      if (edits.length) sink.write(`   ↳ ${fmtFileList(edits, 3)}\n`);
    }
    if (s.phase === "done" && s.summary && !summaryPrinted) {
      summaryPrinted = true;
      const m = s.summary;
      sink.write(`\n Summary  ${m.scoreStart ?? "?"}→${m.score ?? "?"} · ${m.passes} pass${m.passes === 1 ? "" : "es"} · ` +
        `${m.changedFiles.length} files · ${m.findingsRemaining ?? "?"} left\n`);
      sink.write(`   Changed  ${fmtFileList(m.changedFiles, 6)}\n`);
      if (m.sessionId) {
        sink.write(`   Review   aislop agent show ${m.sessionId}\n`);
        sink.write(`   Apply    aislop agent apply ${m.sessionId}\n`);
      }
    }
  });
  return unsub;
};
```
- [ ] **Step 4: Verify PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): plain streamed reporter (non-TTY)"`

---

## Phase 4 — deps + build config

### Task 5: add Ink deps + JSX config

**Files:** Modify `package.json`, `tsconfig.json`

- [ ] **Step 1:** `pnpm add ink react ink-select-input && pnpm add -D @types/react ink-testing-library`
- [ ] **Step 2:** In `tsconfig.json` compilerOptions add `"jsx": "react-jsx"`, `"jsxImportSource": "react"`.
- [ ] **Step 3:** `pnpm build` → Expected: succeeds (tsdown transforms JSX). If JSX errors, confirm tsdown picks up tsconfig `jsx`.
- [ ] **Step 4: Commit** — `git commit -m "build(agent): add ink + react for the agent TUI"`

---

## Phase 5 — Ink components + integration (edits live files; do last, coordinated)

### Task 6: store hook + presentational components

**Files:** Create `src/ui/agent-tui/useStore.ts`, `Sidebar.tsx`, `ActivityPane.tsx`, `DecisionBar.tsx`, `FooterBar.tsx`, `AgentApp.tsx`; Test `tests/ui/agent-tui/sidebar.test.tsx`

- [ ] **Step 1: Failing snapshot test** (Sidebar hides cost/ctx when model unknown)
```tsx
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { Sidebar } from "../../../src/ui/agent-tui/Sidebar.js";
import { createSessionState } from "../../../src/agents/session-state.js";

it("renders score and hides cost when model unknown", () => {
  const store = createSessionState({ provider: "Mystery", providerSource: "auto", targetScore: 90, targetRepo: "/r" });
  store.update({ score: 24, findingsRemaining: 51 });
  const { lastFrame } = render(<Sidebar state={store.getState()} />);
  expect(lastFrame()).toContain("24");
  expect(lastFrame()).not.toContain("$");
});
```
- [ ] **Step 2: Verify FAIL.**
- [ ] **Step 3: Implement** `useStore.ts` (a `useSyncExternalStore` hook over `store.subscribe/getState`) and the components. `Sidebar` maps state → labelled rows; cost/ctx rows render only when `computeCostUsd`/`contextPct` are non-null. `ActivityPane` tails `state.activity`. `DecisionBar` renders `ink-select-input` from `state.pendingDecision` and calls `resolve`. `FooterBar` shows cwd · branch · worktree · `ctrl+c to quit`. `AgentApp` composes them via `useStore`.
  (Full component code written during implementation against the Ink API; keep each component a single focused file; colors mapped from the theme tokens to Ink color strings: success→green, warn→yellow, danger→red, muted→gray, accent→cyan.)
- [ ] **Step 4: Verify PASS** — `npx vitest run tests/ui/agent-tui/`.
- [ ] **Step 5: Commit** — `git commit -m "feat(agent): ink sidebar/activity/decision/footer components"`

### Task 7: mount (alt-screen lifecycle)

**Files:** Create `src/ui/agent-tui/mount.ts`

- [ ] **Step 1-3:** `mountAgentTui(store)` lazy-imports `ink` + `react`, writes `\x1b[?1049h` (enter alt-screen), `render(<AgentApp store/>)`, returns `{ unmount }` that restores with `\x1b[?1049l`. Wrap in try/finally at the call site so the screen is always restored. (No unit test — exercised via integration + manual; keep it tiny.)
- [ ] **Step 4: Commit** — `git commit -m "feat(agent): ink alt-screen mount lifecycle"`

### Task 8: wire the run loop (CONFLICT-SENSITIVE — coordinate)

**Files:** Modify `src/commands/agent-session.ts`, `src/commands/agent-session-steps.ts`

- [ ] **Step 1:** Build `createSessionState(...)` at session start from the resolved provider/options/worktree.
- [ ] **Step 2:** Replace direct checkpoint/summary `stdout.write` blocks with store updates: provider output → `pushActivity` + `recordEdit` + `addTokens`; each pass → `update({score, findingsRemaining})` + `incPass`; end → `finish(summary)`.
- [ ] **Step 3:** Choose renderer: `const tty = process.stdout.isTTY && !options.background && !options.json && !process.env.CI;` → `tty ? mountAgentTui(store) : attachPlainReporter(store)`, in a `try/finally` that unmounts.
- [ ] **Step 4:** `agent-session-steps.ts` decision points call `await store.askDecision(question, options)`. In plain mode, a small adapter resolves it via the existing clack `select()`.
- [ ] **Step 5:** Run full suite `pnpm test`; update any agent-session snapshot tests to the new output. Manual smoke: `node dist/cli.js agent` in a dirty repo (TTY) and `node dist/cli.js agent | cat` (plain).
- [ ] **Step 6: Commit** — `git commit -m "feat(agent): render run loop through the session store + TUI"`

---

## Acceptance criteria (from spec §12)
1. No repeated token/file blocks; deltas only; one canonical changed-files list.
2. TTY → alt-screen TUI (main+sidebar+footer), updates in place, screen restored on exit/ctrl-c.
3. Non-TTY/CI/background/json → clean streamed output, same data, pipe-safe.
4. Cost/ctx% shown only when model known.
5. `scan` cold-start unchanged (Ink lazy-loaded).
6. New tests pass; existing suite green.

## Self-review notes
- Spec coverage: pricing (T1), formatters (T2), store (T3), plain reporter (T4), deps/build (T5), components (T6), mount (T7), integration + decisions (T8). All §9 files covered.
- Types consistent across tasks: `TokenUsage`, `SessionStore`, `AgentSessionState`, `PendingDecision`, `SessionSummary` defined in T1/T3 and reused in T4/T6/T8.
- Placeholder note: T6/T7 component bodies are specified by responsibility + interface rather than full JSX, because exact Ink layout/styling is refined against the live API during implementation; every prop/data source they consume is defined in T3. This is the one deliberate exception to full-code steps.

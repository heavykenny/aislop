import { type AgentUsage, createSessionState, type SessionStore } from "../agents/session-state.js";
import type { TuiHandle } from "./agent-tui/mount.js";

interface AgentTuiContext {
	provider: string;
	source: string;
	directory: string;
	mode: string;
	targetScore: number;
}

interface AgentTuiOptions extends AgentTuiContext {
	write?: (s: string) => void;
	tty?: boolean;
}

interface CompleteStep {
	status: "done" | "warn" | "failed" | "skipped";
	label: string;
}

interface AgentTuiFile {
	filePath: string;
	updatedAt: string;
	source?: string;
	additions?: number | null;
	deletions?: number | null;
	binary?: boolean;
}

const parseScore = (value: string): number | null => {
	const n = Number.parseInt(value.trim(), 10);
	return Number.isNaN(n) ? null : n;
};

const unwrapShell = (cmd: string): string => {
	const match = cmd.match(/-l?c\s+(['"])([\s\S]*)\1\s*$/);
	return match ? match[2] : cmd;
};

const classify = (
	line: string,
): { kind: "assistant" | "tool" | "exec" | "event"; text: string } => {
	for (const kind of ["assistant", "tool", "exec"] as const) {
		if (line.startsWith(`${kind}: `)) {
			const text = line.slice(kind.length + 2);
			return { kind, text: kind === "exec" ? unwrapShell(text) : text };
		}
	}
	return { kind: "event", text: line };
};

export class AgentTui {
	private readonly store: SessionStore;
	private readonly write: (s: string) => void;
	private readonly tty: boolean;
	private handle: Promise<TuiHandle> | null = null;
	private streamedChars = 0;

	constructor(options: AgentTuiOptions) {
		this.write = options.write ?? ((s) => process.stdout.write(s));
		this.tty = options.tty ?? Boolean(process.stdout.isTTY);
		this.store = createSessionState({
			provider: options.provider,
			providerSource: options.source,
			targetRepo: options.directory,
			targetScore: options.targetScore,
		});
	}

	private ensureMounted(): void {
		if (!this.tty || this.handle) return;
		this.handle = import("./agent-tui/mount.js").then((m) => m.mountAgentTui(this.store));
	}

	setActions(actions: string[]): void {
		this.store.update({ actions: actions.filter((action) => action.trim().length > 0) });
	}

	start(label: string): void {
		this.store.addStep(label);
		this.ensureMounted();
	}

	complete(step: CompleteStep): void {
		this.store.completeStep(step.status, step.label);
		if (!this.tty) this.write(` ${step.label}\n`);
	}

	setActiveLabel(label: string): void {
		this.store.setActiveStepLabel(label);
	}

	setMetric(label: string, value: string | number | null | undefined): void {
		const text = value == null ? "" : String(value);
		if (label === "Score") {
			const [start, end] = text.split("->").map((part) => part.trim());
			this.store.update({ scoreStart: parseScore(start ?? ""), score: parseScore(end ?? "") });
		} else if (label === "Remaining") {
			this.store.update({ findingsRemaining: parseScore(text) });
		} else if (label === "Pass") {
			this.store.update({ passes: parseScore(text) ?? 0 });
		} else if (label === "Worktree") {
			this.store.update({ worktree: text || null });
		}
	}

	setUsage(usage: AgentUsage): void {
		this.store.setUsage(usage);
	}

	appendLog(source: string, line: string): void {
		// Codex only reports real usage once (at turn end), so estimate live from
		// streamed bytes (~4 chars/token) until the exact number lands.
		this.streamedChars += line.length;
		this.store.setEstimatedTokens(Math.round(this.streamedChars / 4));
		const entry = classify(line);
		// Drop low-signal lifecycle events (thread/turn/item.*) — the Steps panel
		// and sidebar already carry session state; only show what the agent did.
		if (entry.kind === "event") return;
		// Providers re-emit each command (on start, then in the completion summary),
		// so dedupe against a small recent window, not just the previous line.
		const recent = this.store.getState().activity.slice(-6);
		if (recent.some((a) => a.kind === entry.kind && a.text === entry.text)) return;
		this.store.pushActivity({ ...entry, at: Date.now() });
		if (!this.tty) this.write(`   ${source.padEnd(8)} ${line}\n`);
	}

	setFiles(files: AgentTuiFile[]): void {
		this.store.setFiles(
			files.map((file) => ({
				filePath: file.filePath,
				additions: file.additions,
				deletions: file.deletions,
				binary: file.binary,
			})),
		);
	}

	async askDecision(
		question: string,
		options: { value: string; label: string; hint?: string }[],
	): Promise<string> {
		return this.store.askDecision(question, options);
	}

	async finish(opts: { footer: string }): Promise<void> {
		this.store.finish({
			scoreStart: this.store.getState().scoreStart,
			score: this.store.getState().score,
			passes: this.store.getState().passes,
			findingsRemaining: this.store.getState().findingsRemaining,
			changedFiles: [...this.store.getState().filesChanged],
			worktree: this.store.getState().worktree,
			sessionId: null,
		});
		await this.close();
		if (!this.tty) this.write(` ${opts.footer}\n`);
	}

	async abort(): Promise<void> {
		this.store.update({ phase: "error" });
		await this.close();
	}

	// Tear the alt-screen down fully (await Ink's exit) BEFORE returning, so the
	// caller's summary prints onto the restored shell instead of being wiped.
	private async close(): Promise<void> {
		const pending = this.handle;
		this.handle = null;
		if (!pending) return;
		const handle = await pending;
		await handle.close();
	}
}

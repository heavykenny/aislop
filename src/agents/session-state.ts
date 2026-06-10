import type { TokenUsage } from "./pricing.js";

export interface ActivityLine {
	kind: "assistant" | "tool" | "exec" | "event";
	text: string;
	at: number;
}

export interface EditEntry {
	file: string;
	at: number;
}

export type StepStatus = "running" | "done" | "warn" | "failed" | "skipped";

export interface StepEntry {
	status: StepStatus;
	label: string;
}

export interface FileEntry {
	filePath: string;
	additions?: number | null;
	deletions?: number | null;
	binary?: boolean;
}

export interface AgentUsage {
	inputTokens: number;
	totalTokens: number;
	costUsd?: number;
}

export interface PendingDecision {
	question: string;
	options: { value: string; label: string; hint?: string }[];
	resolve: (value: string) => void;
}

export interface SessionSummary {
	scoreStart: number | null;
	score: number | null;
	passes: number;
	findingsRemaining: number | null;
	changedFiles: string[];
	worktree: string | null;
	sessionId: string | null;
}

export type SessionPhase =
	| "starting"
	| "running"
	| "awaiting-decision"
	| "publishing"
	| "done"
	| "error";

export interface AgentSessionState {
	provider: string;
	model: string | null;
	providerSource: string;
	scoreStart: number | null;
	score: number | null;
	targetScore: number;
	findingsRemaining: number | null;
	filesChanged: Set<string>;
	filesEdited: Set<string>;
	passes: number;
	toolCalls: number;
	tokens: TokenUsage;
	startedAt: number;
	worktree: string | null;
	targetRepo: string;
	branch: string | null;
	activity: ActivityLine[];
	recentEdits: EditEntry[];
	steps: StepEntry[];
	files: FileEntry[];
	actions: string[];
	usage: AgentUsage | null;
	estimatedTokens: number;
	phase: SessionPhase;
	pendingDecision: PendingDecision | null;
	summary: SessionSummary | null;
}

export interface SessionStore {
	getState(): AgentSessionState;
	subscribe(fn: () => void): () => void;
	update(
		patch: Partial<AgentSessionState> | ((s: AgentSessionState) => Partial<AgentSessionState>),
	): void;
	pushActivity(line: ActivityLine): void;
	recordEdit(file: string, at?: number): void;
	addTokens(delta: Partial<TokenUsage>): void;
	addStep(label: string): void;
	completeStep(status: StepStatus, label: string): void;
	setActiveStepLabel(label: string): void;
	setFiles(files: FileEntry[]): void;
	setUsage(usage: AgentUsage): void;
	setEstimatedTokens(tokens: number): void;
	incPass(): void;
	askDecision(question: string, options: PendingDecision["options"]): Promise<string>;
	finish(summary: SessionSummary): void;
}

const ACTIVITY_CAP = 200;
const EDITS_CAP = 8;

type SessionInit = Pick<
	AgentSessionState,
	"provider" | "providerSource" | "targetScore" | "targetRepo"
> &
	Partial<AgentSessionState>;

interface SessionStoreDeps {
	state: AgentSessionState;
	subscribers: Set<() => void>;
	emit: () => void;
}

const buildInitialState = (init: SessionInit): AgentSessionState => ({
	model: null,
	scoreStart: null,
	score: null,
	findingsRemaining: null,
	filesChanged: new Set(),
	filesEdited: new Set(),
	passes: 0,
	toolCalls: 0,
	tokens: { in: 0, out: 0, cached: 0, total: 0 },
	startedAt: Date.now(),
	worktree: null,
	branch: null,
	activity: [],
	recentEdits: [],
	steps: [],
	files: [],
	actions: [],
	usage: null,
	estimatedTokens: 0,
	phase: "starting",
	pendingDecision: null,
	summary: null,
	...init,
});

const activeStepIndex = (steps: StepEntry[]): number => {
	for (let i = steps.length - 1; i >= 0; i -= 1) {
		if (steps[i].status === "running") return i;
	}
	return -1;
};

const createEmitter = (subscribers: Set<() => void>): (() => void) => {
	return () => {
		for (const fn of subscribers) fn();
	};
};

const createCoreMethods = ({
	state,
	subscribers,
	emit,
}: SessionStoreDeps): Pick<SessionStore, "getState" | "subscribe" | "update"> => ({
	getState: () => state,
	subscribe(fn) {
		subscribers.add(fn);
		return () => {
			subscribers.delete(fn);
		};
	},
	update(patch) {
		Object.assign(state, typeof patch === "function" ? patch(state) : patch);
		emit();
	},
});

const createActivityMethods = ({
	state,
	emit,
}: Pick<SessionStoreDeps, "state" | "emit">): Pick<
	SessionStore,
	"pushActivity" | "recordEdit" | "setFiles"
> => ({
	pushActivity(line) {
		state.activity.push(line);
		if (state.activity.length > ACTIVITY_CAP) {
			state.activity.splice(0, state.activity.length - ACTIVITY_CAP);
		}
		emit();
	},
	recordEdit(file, at = Date.now()) {
		state.filesChanged.add(file);
		state.filesEdited.add(file);
		state.recentEdits.push({ file, at });
		if (state.recentEdits.length > EDITS_CAP) {
			state.recentEdits.splice(0, state.recentEdits.length - EDITS_CAP);
		}
		emit();
	},
	setFiles(files) {
		state.files = files;
		for (const file of files) state.filesChanged.add(file.filePath);
		emit();
	},
});

const createProgressMethods = ({
	state,
	emit,
}: Pick<SessionStoreDeps, "state" | "emit">): Pick<
	SessionStore,
	| "addTokens"
	| "incPass"
	| "addStep"
	| "completeStep"
	| "setActiveStepLabel"
	| "setUsage"
	| "setEstimatedTokens"
> => ({
	addTokens(delta) {
		const t = state.tokens;
		state.tokens = {
			in: t.in + (delta.in ?? 0),
			out: t.out + (delta.out ?? 0),
			cached: t.cached + (delta.cached ?? 0),
			total: t.total + (delta.total ?? 0),
		};
		emit();
	},
	incPass() {
		state.passes += 1;
		emit();
	},
	addStep(label) {
		state.steps.push({ status: "running", label });
		emit();
	},
	completeStep(status, label) {
		const index = activeStepIndex(state.steps);
		if (index >= 0) state.steps[index] = { status, label };
		else state.steps.push({ status, label });
		emit();
	},
	setActiveStepLabel(label) {
		const index = activeStepIndex(state.steps);
		if (index >= 0) {
			state.steps[index] = { ...state.steps[index], label };
			emit();
		}
	},
	setUsage(usage) {
		state.usage = usage;
		state.estimatedTokens = 0;
		state.tokens = { ...state.tokens, total: usage.totalTokens, in: usage.inputTokens };
		emit();
	},
	setEstimatedTokens(tokens) {
		if (state.usage) return;
		state.estimatedTokens = tokens;
		emit();
	},
});

const createDecisionMethods = ({
	state,
	emit,
}: Pick<SessionStoreDeps, "state" | "emit">): Pick<SessionStore, "askDecision" | "finish"> => ({
	askDecision(question, options) {
		return new Promise<string>((resolve) => {
			state.pendingDecision = {
				question,
				options,
				resolve: (value) => {
					state.pendingDecision = null;
					state.phase = "running";
					emit();
					resolve(value);
				},
			};
			state.phase = "awaiting-decision";
			emit();
		});
	},
	finish(summary) {
		state.summary = summary;
		state.phase = "done";
		emit();
	},
});

export const createSessionState = (init: SessionInit): SessionStore => {
	const state = buildInitialState(init);
	const subscribers = new Set<() => void>();
	const emit = createEmitter(subscribers);
	const deps = { state, subscribers, emit };

	return {
		...createCoreMethods(deps),
		...createActivityMethods(deps),
		...createProgressMethods(deps),
		...createDecisionMethods(deps),
	};
};

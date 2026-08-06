import type { TokenUsage } from "./pricing.js";

export interface ActivityLine {
	kind: "assistant" | "tool" | "exec" | "event";
	text: string;
	at: number;
}

interface EditEntry {
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

interface SessionSummary {
	scoreStart: number | null;
	score: number | null;
	passes: number;
	findingsRemaining: number | null;
	changedFiles: string[];
	worktree: string | null;
	sessionId: string | null;
}

type SessionPhase = "starting" | "running" | "awaiting-decision" | "publishing" | "done" | "error";

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

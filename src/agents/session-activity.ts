import fs from "node:fs";
import path from "node:path";
import type { ProviderUsage } from "./provider-metadata.js";
import type { AgentSessionRecorder } from "./session.js";
import { diffNameOnly } from "./worktree.js";

export interface EditedFileActivity {
	filePath: string;
	updatedAt: string;
	source: string;
}

export interface AgentUsageTotals {
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd?: number;
}

export interface AgentSessionStats {
	providerPasses: number;
	toolCalls: number;
	outputEvents: number;
}

export const createUsageTotals = (): AgentUsageTotals => ({
	inputTokens: 0,
	cachedInputTokens: 0,
	outputTokens: 0,
	totalTokens: 0,
});

export const createSessionStats = (): AgentSessionStats => ({
	providerPasses: 0,
	toolCalls: 0,
	outputEvents: 0,
});

export const mergeProviderUsage = (
	totals: AgentUsageTotals,
	usage: Partial<ProviderUsage>,
): AgentUsageTotals => {
	const inputTokens = Math.max(totals.inputTokens, usage.inputTokens ?? 0);
	const cachedInputTokens = Math.max(totals.cachedInputTokens, usage.cachedInputTokens ?? 0);
	const outputTokens = Math.max(totals.outputTokens, usage.outputTokens ?? 0);
	const totalTokens = Math.max(
		totals.totalTokens,
		usage.totalTokens ?? inputTokens + cachedInputTokens + outputTokens,
	);
	const costUsd =
		usage.costUsd === undefined ? totals.costUsd : Math.max(totals.costUsd ?? 0, usage.costUsd);
	return {
		inputTokens,
		cachedInputTokens,
		outputTokens,
		totalTokens,
		...(costUsd !== undefined ? { costUsd } : {}),
	};
};

export const formatUsageTotals = (usage: AgentUsageTotals): string => {
	if (usage.totalTokens === 0 && usage.costUsd === undefined) return "unknown";
	const tokens = [
		`${usage.totalTokens.toLocaleString()} total`,
		`${usage.inputTokens.toLocaleString()} in`,
		`${usage.outputTokens.toLocaleString()} out`,
	];
	if (usage.cachedInputTokens > 0)
		tokens.push(`${usage.cachedInputTokens.toLocaleString()} cached`);
	if (usage.costUsd !== undefined) tokens.push(`$${usage.costUsd.toFixed(4)}`);
	return tokens.join(" / ");
};

export const formatToolCalls = (count: number): string =>
	`${count.toLocaleString()} tool call${count === 1 ? "" : "s"}`;

export const isProviderToolLine = (line: string | null | undefined): boolean =>
	Boolean(line?.startsWith("exec: ") || line?.startsWith("tool: "));

export const createChangedFileTracker = (input: {
	cwd: string;
	session?: AgentSessionRecorder;
	onChange: (files: EditedFileActivity[]) => void;
}) => {
	const files = new Map<string, EditedFileActivity>();
	let timer: NodeJS.Timeout | undefined;
	let pending = false;

	const noteFile = (filePath: string, source: string): void => {
		const absolute = path.join(input.cwd, filePath);
		const stat = fs.existsSync(absolute) ? fs.statSync(absolute) : null;
		const updatedAt = (stat?.mtime ?? new Date()).toISOString();
		const prior = files.get(filePath);
		if (prior?.updatedAt === updatedAt && prior.source === source) return;
		const next = { filePath, updatedAt, source };
		files.set(filePath, next);
		input.session?.append("file.changed", next);
		input.onChange([...files.values()]);
	};

	const refresh = async (source = "git diff"): Promise<EditedFileActivity[]> => {
		if (pending) return [...files.values()];
		pending = true;
		try {
			for (const filePath of await diffNameOnly(input.cwd)) {
				noteFile(filePath, source);
			}
			return [...files.values()];
		} finally {
			pending = false;
		}
	};

	const start = (): void => {
		if (timer) return;
		timer = setInterval(() => {
			void refresh("git diff");
		}, 1000);
		timer.unref();
	};

	const stop = async (): Promise<EditedFileActivity[]> => {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
		return refresh("git diff");
	};

	return {
		noteFile,
		refresh,
		start,
		stop,
		files: () => [...files.values()],
	};
};

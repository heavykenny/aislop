import { formatProviderOutputLine } from "../agents/provider-output.js";
import { formatToolCalls } from "../agents/session-activity.js";
import type { AgentSessionEvent, AgentSessionSummary } from "../agents/session-store.js";
import { renderDisplayRows, renderDisplaySection } from "../ui/display.js";

const asObject = (value: unknown): Record<string, unknown> | null =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asNumber = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const selectedCount = (events: AgentSessionEvent[]): number | null => {
	const event = events.find((item) => item.type === "findings.selected");
	return asNumber(event?.count);
};

const verifiedDiagnostics = (events: AgentSessionEvent[]): number | null => {
	const event = events.find((item) => item.type === "diff.verified");
	const scan = asObject(event?.scan);
	return asNumber(scan?.diagnostics);
};

const providerOutcome = (events: AgentSessionEvent[]): string => {
	const skipped = events.find((item) => item.type === "provider.skipped");
	if (skipped) return `skipped (${skipped.reason ?? "not needed"})`;
	const finished = [...events].reverse().find((item) => item.type === "provider.finished");
	if (finished) {
		const pass = asNumber(finished.pass);
		const tools = asNumber(finished.toolCalls);
		const exitCode = asNumber(finished.exitCode);
		const exitText =
			exitCode === 0 || exitCode === null ? "finished" : `finished with exit ${exitCode}`;
		return [
			pass === null ? "provider" : `pass ${pass}`,
			exitText,
			tools === null ? null : formatToolCalls(tools),
		]
			.filter(Boolean)
			.join(" · ");
	}
	const started = events.find((item) => item.type === "provider.started");
	return started ? "running" : "not started";
};

const applyOutcome = (events: AgentSessionEvent[], summary: AgentSessionSummary): string => {
	if (summary.applied) return "applied";
	const skipped = events.find((item) => item.type === "diff.apply_skipped");
	return skipped ? "not applied" : "not requested";
};

const publishOutcome = (events: AgentSessionEvent[], summary: AgentSessionSummary): string => {
	if (summary.published) return "published";
	const skipped = events.find((item) => item.type === "publish.skipped");
	if (skipped) return `skipped (${skipped.reason ?? "not needed"})`;
	return events.some((item) => item.type === "publish.started") ? "started" : "not requested";
};

const usageOutcome = (summary: AgentSessionSummary): string => {
	if (summary.totalTokens === null && summary.costUsd === null) return "n/a";
	const parts: string[] = [];
	if (summary.totalTokens !== null) parts.push(`${summary.totalTokens.toLocaleString()} tokens`);
	if (summary.costUsd !== null) parts.push(`$${summary.costUsd.toFixed(4)}`);
	return parts.join(" / ");
};

const providerNotes = (events: AgentSessionEvent[]): string[] =>
	events
		.filter((event) => event.type === "provider.output" && typeof event.line === "string")
		.map((event) =>
			typeof event.displayLine === "string"
				? event.displayLine
				: (formatProviderOutputLine(String(event.line)) ?? ""),
		)
		.filter((line) => /false positive|intentional|skip|skipped|ignore/i.test(line))
		.slice(-4);

export const renderAgentSessionReview = (input: {
	summary: AgentSessionSummary;
	events: AgentSessionEvent[];
}): string[] => {
	const selected = selectedCount(input.events);
	const remaining = verifiedDiagnostics(input.events);
	const lines = [
		renderDisplaySection("Review summary"),
		...renderDisplayRows(
			[
				{
					label: "Score",
					value: `${input.summary.scoreBefore ?? "n/a"} -> ${input.summary.scoreAfter ?? "n/a"}`,
				},
				{ label: "Selected", value: String(selected ?? "n/a") },
				{ label: "Remaining", value: String(remaining ?? "n/a") },
				{ label: "Changed", value: String(input.summary.changedFiles ?? 0) },
				{ label: "Usage", value: usageOutcome(input.summary) },
				{ label: "Passes", value: String(input.summary.providerPasses ?? "n/a") },
				{
					label: "Tools",
					value:
						input.summary.toolCalls === null ? "n/a" : formatToolCalls(input.summary.toolCalls),
				},
				{ label: "Provider", value: providerOutcome(input.events) },
				{ label: "Apply", value: applyOutcome(input.events, input.summary) },
				{ label: "Publish", value: publishOutcome(input.events, input.summary) },
			],
			{ indent: 3, labelWidth: 9 },
		),
	];
	const notes = providerNotes(input.events);
	if (notes.length > 0) {
		lines.push("", renderDisplaySection("Provider notes"));
		for (const note of notes)
			lines.push(` - ${note.length > 180 ? `${note.slice(0, 177)}...` : note}`);
	}
	return lines;
};

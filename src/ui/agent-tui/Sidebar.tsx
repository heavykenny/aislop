import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { computeCostUsd, resolvePricing } from "../../agents/pricing.js";
import type { AgentSessionState } from "../../agents/session-state.js";
import { fmtElapsed, fmtTokens } from "./format.js";

const Row = ({ label, value, color }: { label: string; value: string; color?: string }) => (
	<Box>
		<Box width={9}>
			<Text dimColor>{label}</Text>
		</Box>
		<Text color={color}>{value}</Text>
	</Box>
);

const scoreColor = (score: number | null, target: number): string => {
	if (score == null) return "white";
	if (score >= target) return "green";
	if (score >= target * 0.7) return "yellow";
	return "red";
};

// Reading the clock during render makes the component impure and, with nothing
// driving a re-render, leaves elapsed stale until an unrelated update happens.
const useElapsedSince = (startedAt: number): number => {
	const [now, setNow] = useState(startedAt);
	useEffect(() => {
		const tick = () => setNow(Date.now());
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	}, []);
	return Math.max(0, now - startedAt);
};

export const Sidebar = ({ state }: { state: AgentSessionState }) => {
	const elapsed = useElapsedSince(state.startedAt);
	const pricing = resolvePricing(state.provider, state.model);
	const cost = state.usage?.costUsd ?? computeCostUsd(pricing, state.tokens);
	// Context is the share of the model window the current turn occupies, so it
	// uses live input tokens (not the lifetime total, which can exceed 100%).
	const ctx = pricing ? (state.tokens.in / pricing.contextWindow) * 100 : null;
	const hasUsage = state.tokens.total > 0;
	const title = state.model ? `${state.provider} · ${state.model}` : state.provider;

	return (
		<Box
			flexDirection="column"
			width={30}
			alignSelf="flex-start"
			paddingX={1}
			borderStyle="round"
			borderColor="gray"
		>
			<Text bold>{title}</Text>
			<Box marginTop={1} flexDirection="column">
				<Row
					label="Score"
					value={
						state.score != null && state.score >= state.targetScore
							? `${state.score} ✓`
							: `${state.score ?? "--"} → ${state.targetScore}`
					}
					color={scoreColor(state.score, state.targetScore)}
				/>
				<Row
					label="Left"
					value={state.findingsRemaining == null ? "--" : String(state.findingsRemaining)}
				/>
				<Row label="Files" value={String(state.filesChanged.size)} />
				<Row label="Passes" value={String(state.passes)} />
				<Row
					label="Tokens"
					value={
						hasUsage
							? fmtTokens(state.tokens.total)
							: state.estimatedTokens > 0
								? `~${fmtTokens(state.estimatedTokens)}`
								: "--"
					}
				/>
				{hasUsage && cost != null ? <Row label="Cost" value={`$${cost.toFixed(2)}`} /> : null}
				{hasUsage && ctx != null ? <Row label="Context" value={`${Math.round(ctx)}%`} /> : null}
				<Row label="Elapsed" value={fmtElapsed(elapsed)} />
			</Box>
		</Box>
	);
};

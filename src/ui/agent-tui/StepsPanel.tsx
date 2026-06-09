import { Box, Text } from "ink";
import type { StepEntry, StepStatus } from "../../agents/session-state.js";
import { Spinner } from "./Spinner.js";

const glyph = (status: StepStatus): string => {
	if (status === "done") return "✓";
	if (status === "warn") return "!";
	if (status === "failed") return "✗";
	return "·";
};

const colorFor = (status: StepStatus): string => {
	if (status === "running" || status === "done") return "cyan";
	if (status === "warn") return "yellow";
	if (status === "failed") return "red";
	return "gray";
};

export const StepsPanel = ({ steps }: { steps: StepEntry[] }) => {
	if (steps.length === 0) return null;
	return (
		<Box flexDirection="column" paddingX={1}>
			<Text dimColor>Steps</Text>
			{steps.slice(-6).map((step, index) => (
				<Text key={`${index}-${step.label}`} color={colorFor(step.status)} wrap="truncate-end">
					{step.status === "running" ? <Spinner color="cyan" /> : glyph(step.status)} {step.label}
				</Text>
			))}
		</Box>
	);
};

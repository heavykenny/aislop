import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import type { PendingDecision } from "../../agents/session-state.js";

export const DecisionBar = ({ decision }: { decision: PendingDecision }) => {
	const items = decision.options.map((option) => ({
		label: option.hint ? `${option.label}  (${option.hint})` : option.label,
		value: option.value,
	}));
	return (
		<Box flexDirection="column" paddingX={1} borderStyle="round" borderColor="cyan">
			<Text bold>{decision.question}</Text>
			<SelectInput items={items} onSelect={(item) => decision.resolve(item.value)} />
		</Box>
	);
};

import { Box, Text } from "ink";
import type { ActivityLine } from "../../agents/session-state.js";

const colorFor = (kind: ActivityLine["kind"]): string => {
	if (kind === "tool") return "cyan";
	if (kind === "exec") return "yellow";
	if (kind === "event") return "gray";
	return "white";
};

const prefixFor = (kind: ActivityLine["kind"]): string => (kind === "assistant" ? "" : `${kind} `);

export const ActivityPane = ({ activity, rows }: { activity: ActivityLine[]; rows: number }) => {
	const visible = activity.slice(-Math.max(1, rows));
	return (
		<Box flexDirection="column" flexGrow={1} paddingX={1}>
			{visible.map((line, index) => (
				<Text key={`${line.at}-${index}`} color={colorFor(line.kind)} wrap="truncate-end">
					<Text dimColor>{prefixFor(line.kind)}</Text>
					{line.text}
				</Text>
			))}
		</Box>
	);
};

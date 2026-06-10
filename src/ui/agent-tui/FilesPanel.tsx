import { Box, Text } from "ink";
import type { FileEntry } from "../../agents/session-state.js";

const DiffStat = ({ file }: { file: FileEntry }) => {
	if (file.binary) return <Text dimColor>binary</Text>;
	if (typeof file.additions === "number" || typeof file.deletions === "number") {
		return (
			<Text>
				<Text color="green">+{file.additions ?? 0}</Text>{" "}
				<Text color="red">-{file.deletions ?? 0}</Text>
			</Text>
		);
	}
	return <Text dimColor>changed</Text>;
};

export const FilesPanel = ({ files }: { files: FileEntry[] }) => {
	if (files.length === 0) return null;
	const shown = files.slice(-5);
	return (
		<Box flexDirection="column" paddingX={1}>
			<Text dimColor>Edited files</Text>
			{shown.map((file) => (
				<Text key={file.filePath} wrap="truncate-middle">
					<Text color="green">✓ </Text>
					{file.filePath} <DiffStat file={file} />
				</Text>
			))}
			{files.length > shown.length ? (
				<Text dimColor>+{files.length - shown.length} more</Text>
			) : null}
		</Box>
	);
};

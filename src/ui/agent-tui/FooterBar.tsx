import { Box, Text } from "ink";

export const FooterBar = ({
	repo,
	branch,
	worktree,
}: {
	repo: string;
	branch: string | null;
	worktree: string | null;
}) => (
	<Box paddingX={1} justifyContent="space-between">
		<Text dimColor wrap="truncate-middle">
			{repo}
			{branch ? `  ${branch}` : ""}
			{worktree ? `  ↳ ${worktree}` : ""}
		</Text>
		<Text dimColor>ctrl+c to quit</Text>
	</Box>
);

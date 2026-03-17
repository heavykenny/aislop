const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

const ESC = "\x1B";
const ANSI_RE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");

const stripAnsi = (text: string): string => text.replace(ANSI_RE, "");

export const countRenderedLines = (text: string, columns = DEFAULT_COLUMNS): number => {
	const width = Math.max(1, columns);
	return text.split("\n").reduce((count, line) => {
		const visibleLine = stripAnsi(line).replaceAll("\t", "    ");
		return count + Math.max(1, Math.ceil(visibleLine.length / width));
	}, 0);
};

export const shouldPageOutput = (
	text: string,
	options: {
		stdinIsTTY?: boolean;
		stdoutIsTTY?: boolean;
		rows?: number;
		columns?: number;
	} = {},
): boolean => {
	if (text.trim().length === 0) return false;

	const stdinIsTTY = options.stdinIsTTY ?? Boolean(process.stdin.isTTY);
	const stdoutIsTTY = options.stdoutIsTTY ?? Boolean(process.stdout.isTTY);
	if (!stdinIsTTY || !stdoutIsTTY) return false;

	const rows = Math.max(1, options.rows ?? process.stdout.rows ?? DEFAULT_ROWS);
	const columns = Math.max(1, options.columns ?? process.stdout.columns ?? DEFAULT_COLUMNS);

	return countRenderedLines(text, columns) > rows - 1;
};

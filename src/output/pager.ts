import { spawn } from "node:child_process";

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const ANSI_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g");

const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, "");

const resolvePagerCommand = (): { command: string; args: string[] } => {
	const pager = process.env.PAGER?.trim();
	if (pager) {
		const [command, ...args] = pager.split(/\s+/);
		if (command) {
			return { command, args };
		}
	}

	return { command: "less", args: ["-R", "-F", "-X"] };
};

const writeToStdout = (text: string): void => {
	process.stdout.write(text);
};

const pipeToPager = async (
	command: string,
	args: string[],
	text: string,
): Promise<boolean> =>
	new Promise((resolve) => {
		let settled = false;
		const finish = (success: boolean) => {
			if (settled) return;
			settled = true;
			resolve(success);
		};

		try {
			const child = spawn(command, args, {
				stdio: ["pipe", "inherit", "inherit"],
				windowsHide: true,
			});

			child.once("error", () => finish(false));
			child.once("close", (code) => finish(code === 0));
			child.stdin?.on("error", () => undefined);
			child.stdin?.end(text);
		} catch {
			finish(false);
		}
	});

export const countRenderedLines = (
	text: string,
	columns = DEFAULT_COLUMNS,
): number => {
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
	const columns = Math.max(
		1,
		options.columns ?? process.stdout.columns ?? DEFAULT_COLUMNS,
	);

	return countRenderedLines(text, columns) > rows - 1;
};

export const printMaybePaged = async (text: string): Promise<void> => {
	if (!shouldPageOutput(text)) {
		writeToStdout(text);
		return;
	}

	const pager = resolvePagerCommand();
	const didPage = await pipeToPager(pager.command, pager.args, text);

	if (!didPage) {
		writeToStdout(text);
	}
};

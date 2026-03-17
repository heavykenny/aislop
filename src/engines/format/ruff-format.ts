import path from "node:path";
import { runSubprocess } from "../../utils/subprocess.js";
import { resolveToolBinary } from "../../utils/tooling.js";
import type { Diagnostic, EngineContext } from "../types.js";

export const runRuffFormat = async (context: EngineContext): Promise<Diagnostic[]> => {
	const ruffBinary = resolveToolBinary("ruff");
	try {
		const result = await runSubprocess(
			ruffBinary,
			["format", "--check", "--diff", context.rootDirectory],
			{
				cwd: context.rootDirectory,
				timeout: 60000,
			},
		);

		if (result.exitCode === 0) return [];

		// Ruff format --check outputs files that would be changed
		const output = result.stdout || result.stderr;
		return parseRuffFormatOutput(output, context.rootDirectory);
	} catch {
		return [];
	}
};

const parseRuffFormatOutput = (output: string, rootDir: string): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];
	const filePattern = /^--- (.+)$/gm;
	let match: RegExpExecArray | null;

	while ((match = filePattern.exec(output)) !== null) {
		const filePath = match[1].replace(/^a\//, "");
		diagnostics.push({
			filePath: path.relative(rootDir, filePath),
			engine: "format",
			rule: "python-formatting",
			severity: "warning",
			message: "Python file is not formatted correctly",
			help: "Run `aislop fix` to auto-format with ruff",
			line: 0,
			column: 0,
			category: "Format",
			fixable: true,
		});
	}

	return diagnostics;
};

export const fixRuffFormat = async (rootDirectory: string): Promise<void> => {
	const ruffBinary = resolveToolBinary("ruff");
	const result = await runSubprocess(ruffBinary, ["format", rootDirectory], {
		cwd: rootDirectory,
		timeout: 60000,
	});
	if (result.exitCode !== 0) {
		throw new Error(
			result.stderr || result.stdout || `ruff format exited with code ${result.exitCode}`,
		);
	}
};

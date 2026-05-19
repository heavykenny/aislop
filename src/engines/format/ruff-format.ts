import { runSubprocess } from "../../utils/subprocess.js";
import { resolveToolBinary } from "../../utils/tooling.js";
import { getPythonTargets, getRuffDiagnosticPath } from "../python-targets.js";
import type { Diagnostic, EngineContext } from "../types.js";

export const runRuffFormat = async (context: EngineContext): Promise<Diagnostic[]> => {
	const ruffBinary = resolveToolBinary("ruff");
	const targets = getPythonTargets(context);
	if (targets.length === 0) return [];

	try {
		const result = await runSubprocess(ruffBinary, ["format", "--check", "--diff", ...targets], {
			cwd: context.rootDirectory,
			timeout: 60000,
		});

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
		const filePath = getRuffDiagnosticPath(rootDir, match[1]);
		diagnostics.push({
			filePath,
			engine: "format",
			rule: "python-formatting",
			severity: "warning",
			message: "Python file is not formatted correctly",
			help: "Run `npx aislop fix` to auto-format with ruff",
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

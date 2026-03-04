import path from "node:path";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";

interface RuffDiagnostic {
	code: string;
	message: string;
	filename: string;
	location: { row: number; column: number };
	fix?: { applicability: string };
}

export const runRuffLint = async (
	context: EngineContext,
): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess(
			"ruff",
			["check", "--output-format=json", context.rootDirectory],
			{
				cwd: context.rootDirectory,
				timeout: 60000,
			},
		);

		const output = result.stdout;
		if (!output) return [];

		const diagnostics: RuffDiagnostic[] = JSON.parse(output);
		return diagnostics.map((d) => ({
			filePath: path.relative(context.rootDirectory, d.filename),
			engine: "lint" as const,
			rule: `ruff/${d.code}`,
			severity:
				d.code.startsWith("E") || d.code.startsWith("F")
					? ("error" as const)
					: ("warning" as const),
			message: d.message,
			help: "",
			line: d.location.row,
			column: d.location.column,
			category: "Python Lint",
			fixable: d.fix?.applicability === "safe",
		}));
	} catch {
		return [];
	}
};

export const fixRuffLint = async (rootDirectory: string): Promise<void> => {
	const result = await runSubprocess(
		"ruff",
		["check", "--fix", rootDirectory],
		{
			cwd: rootDirectory,
			timeout: 60000,
		},
	);
	if (result.exitCode !== 0) {
		throw new Error(
			result.stderr ||
				result.stdout ||
				`ruff check --fix exited with code ${result.exitCode}`,
		);
	}
};

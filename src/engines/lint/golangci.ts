import path from "node:path";
import { runSubprocess } from "../../utils/subprocess.js";
import { resolveToolBinary } from "../../utils/tooling.js";
import type { Diagnostic, EngineContext } from "../types.js";

interface GolangciIssue {
	FromLinter: string;
	Text: string;
	Pos: { Filename: string; Line: number; Column: number };
}

export const runGolangciLint = async (context: EngineContext): Promise<Diagnostic[]> => {
	const golangciBinary = resolveToolBinary("golangci-lint");
	try {
		const result = await runSubprocess(golangciBinary, ["run", "--out-format=json", "./..."], {
			cwd: context.rootDirectory,
			timeout: 120000,
		});

		const output = result.stdout;
		if (!output) return [];

		let parsed: { Issues?: GolangciIssue[] };
		try {
			parsed = JSON.parse(output);
		} catch {
			return [];
		}

		return (parsed.Issues ?? []).map((issue) => ({
			filePath: path.relative(context.rootDirectory, issue.Pos.Filename),
			engine: "lint" as const,
			rule: `go/${issue.FromLinter}`,
			severity: "warning" as const,
			message: issue.Text,
			help: "",
			line: issue.Pos.Line,
			column: issue.Pos.Column,
			category: "Go Lint",
			fixable: false,
		}));
	} catch {
		return [];
	}
};

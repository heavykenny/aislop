import path from "node:path";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";

export const runGofmt = async (context: EngineContext): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess("gofmt", ["-l", context.rootDirectory], {
			cwd: context.rootDirectory,
			timeout: 60000,
		});

		if (!result.stdout) return [];

		const files = result.stdout.split("\n").filter((f) => f.length > 0);
		return files.map((file) => ({
			filePath: path.relative(context.rootDirectory, file),
			engine: "format" as const,
			rule: "go-formatting",
			severity: "warning" as const,
			message: "Go file is not formatted correctly",
			help: "Run `npx aislop fix` to auto-format with gofmt",
			line: 0,
			column: 0,
			category: "Format",
			fixable: true,
		}));
	} catch {
		return [];
	}
};

export const fixGofmt = async (rootDirectory: string): Promise<void> => {
	const result = await runSubprocess("gofmt", ["-w", rootDirectory], {
		cwd: rootDirectory,
		timeout: 60000,
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr || result.stdout || `gofmt exited with code ${result.exitCode}`);
	}
};

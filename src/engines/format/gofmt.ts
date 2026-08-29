import path from "node:path";
import { relativePosix } from "../../utils/paths.js";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";

const GO_EXTENSIONS = new Set([".go"]);

const gofmtTargets = (context: EngineContext): string[] => {
	if (!context.files) return [context.rootDirectory];
	return [
		...new Set(
			context.files
				.filter((filePath) => GO_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
				.map((filePath) => relativePosix(context.rootDirectory, filePath))
				.filter((filePath) => filePath.length > 0 && !filePath.startsWith("..")),
		),
	];
};

export const runGofmt = async (context: EngineContext): Promise<Diagnostic[]> => {
	const targets = gofmtTargets(context);
	if (targets.length === 0) return [];
	try {
		const result = await runSubprocess("gofmt", ["-l", ...targets], {
			cwd: context.rootDirectory,
			timeout: 60000,
		});

		if (!result.stdout) return [];

		const files = result.stdout.split("\n").filter((f) => f.length > 0);
		return files.map((file) => ({
			filePath: relativePosix(context.rootDirectory, file),
			engine: "format" as const,
			rule: "go-formatting",
			severity: "warning" as const,
			message: "Go file is not formatted correctly",
			help: "Run `aislop fix` to auto-format with gofmt",
			line: 0,
			column: 0,
			category: "Format",
			fixable: true,
		}));
	} catch {
		return [];
	}
};

export const fixGofmt = async (context: EngineContext): Promise<void> => {
	const targets = gofmtTargets(context);
	if (targets.length === 0) return;
	const result = await runSubprocess("gofmt", ["-w", ...targets], {
		cwd: context.rootDirectory,
		timeout: 60000,
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr || result.stdout || `gofmt exited with code ${result.exitCode}`);
	}
};

import { createRequire } from "node:module";
import path from "node:path";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";

const esmRequire = createRequire(import.meta.url);

const resolveLocalBiomeScript = (): string | null => {
	try {
		const packageJsonPath = esmRequire.resolve("@biomejs/biome/package.json");
		return path.join(path.dirname(packageJsonPath), "bin", "biome");
	} catch {
		return null;
	}
};

const runBiome = async (
	args: string[],
	rootDirectory: string,
	timeout: number,
): Promise<Awaited<ReturnType<typeof runSubprocess>>> => {
	const localScript = resolveLocalBiomeScript();
	if (localScript) {
		return runSubprocess(process.execPath, [localScript, ...args], {
			cwd: rootDirectory,
			timeout,
		});
	}

	return runSubprocess("biome", args, {
		cwd: rootDirectory,
		timeout,
	});
};

export const runBiomeFormat = async (
	context: EngineContext,
): Promise<Diagnostic[]> => {
	const args = [
		"check",
		"--formatter-enabled=true",
		"--linter-enabled=false",
		"--organize-imports-enabled=true",
		"--diagnostic-level=warn",
		context.rootDirectory,
	];

	try {
		const result = await runBiome(args, context.rootDirectory, 60000);

		const output = result.stderr || result.stdout;
		if (!output) return [];

		return parseBiomeOutput(output, context.rootDirectory);
	} catch {
		return [];
	}
};

const ISSUE_PATTERN = /^(.+?):(\d+):(\d+)\s+(.+)/;
const FILE_PATTERN = /^(.+?)\s+(format|organizeImports)/;

const parseBiomeLine = (line: string, rootDir: string): Diagnostic | null => {
	const match = line.match(ISSUE_PATTERN);
	if (match) {
		return {
			filePath: path.relative(rootDir, match[1]),
			engine: "format",
			rule: "formatting",
			severity: "warning",
			message: "File is not formatted correctly",
			help: "Run `slop fix` to auto-format",
			line: parseInt(match[2], 10),
			column: parseInt(match[3], 10),
			category: "Format",
			fixable: true,
		};
	}

	const fileMatch = line.match(FILE_PATTERN);
	if (!fileMatch) return null;

	const isImports = fileMatch[2] === "organizeImports";
	return {
		filePath: path.relative(rootDir, fileMatch[1]),
		engine: "format",
		rule: isImports ? "import-order" : "formatting",
		severity: "warning",
		message: isImports
			? "Imports are not organized"
			: "File is not formatted correctly",
		help: "Run `slop fix` to auto-format",
		line: 0,
		column: 0,
		category: "Format",
		fixable: true,
	};
};

const parseBiomeOutput = (output: string, rootDir: string): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];
	for (const line of output.split("\n")) {
		const diagnostic = parseBiomeLine(line, rootDir);
		if (diagnostic) diagnostics.push(diagnostic);
	}
	return diagnostics;
};

export const fixBiomeFormat = async (rootDirectory: string): Promise<void> => {
	await runBiome(["check", "--write", rootDirectory], rootDirectory, 60000);
};

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
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

const BIOME_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

const getBiomeTargets = (context: EngineContext): string[] =>
	getSourceFiles(context)
		.filter((filePath) => BIOME_EXTENSIONS.has(path.extname(filePath)))
		.map((filePath) => path.relative(context.rootDirectory, filePath));

const projectUsesDecorators = (rootDir: string): boolean => {
	try {
		const tsconfigPath = path.join(rootDir, "tsconfig.json");
		if (!fs.existsSync(tsconfigPath)) return false;
		const content = fs.readFileSync(tsconfigPath, "utf-8");
		return /experimentalDecorators.*true/i.test(content);
	} catch {
		return false;
	}
};

export const runBiomeFormat = async (context: EngineContext): Promise<Diagnostic[]> => {
	const targets = getBiomeTargets(context);
	if (targets.length === 0) return [];
	const args = ["format", "--reporter=json", ...targets];

	try {
		const result = await runBiome(args, context.rootDirectory, 60000);
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
		if (!output) return [];

		let diagnostics = parseBiomeJsonOutput(output, context.rootDirectory);

		// Filter out decorator-related parse errors for projects using experimentalDecorators
		if (projectUsesDecorators(context.rootDirectory)) {
			diagnostics = diagnostics.filter((d) => {
				const msg = d.message.toLowerCase();
				return !msg.includes("decorator") && !msg.includes("parsing error");
			});
		}

		return diagnostics;
	} catch {
		return [];
	}
};

interface BiomeJsonDiagnostic {
	severity?: string;
	message?: string;
	location?: {
		path?: string;
		start?: {
			line?: number;
			column?: number;
		};
	};
}

interface BiomeJsonPayload {
	diagnostics?: BiomeJsonDiagnostic[];
}

const parseBiomeJsonOutput = (output: string, rootDir: string): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;

		let parsed: BiomeJsonPayload | null = null;
		try {
			parsed = JSON.parse(trimmed) as BiomeJsonPayload;
		} catch {
			parsed = null;
		}
		if (!parsed || !Array.isArray(parsed.diagnostics)) continue;

		for (const entry of parsed.diagnostics) {
			const rawPath = entry.location?.path;
			if (!rawPath) continue;
			const severity = entry.severity === "error" ? "error" : "warning";
			diagnostics.push({
				filePath: path.isAbsolute(rawPath) ? path.relative(rootDir, rawPath) : rawPath,
				engine: "format",
				rule: "formatting",
				severity,
				message: entry.message ?? "File is not formatted correctly",
				help: "Run `aislop fix` to auto-format",
				line: entry.location?.start?.line ?? 0,
				column: entry.location?.start?.column ?? 0,
				category: "Format",
				fixable: true,
			});
		}
	}
	return diagnostics;
};

export const fixBiomeFormat = async (context: EngineContext): Promise<void> => {
	const targets = getBiomeTargets(context);
	if (targets.length === 0) return;

	await runBiome(["format", "--write", ...targets], context.rootDirectory, 60000);
};

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { prefixUnusedVars, type UnusedVarTarget } from "../code-quality/unused-var-rename.js";
import { runSubprocess } from "../../utils/subprocess.js";
import { isExcludedFromScan } from "../../utils/source-files.js";
import type { Diagnostic, EngineContext } from "../types.js";
import { createOxlintConfig, type TestFramework } from "./oxlint-config.js";

const esmRequire = createRequire(import.meta.url);

interface OxlintDiagnostic {
	message: string;
	code: string;
	severity: "warning" | "error";
	help: string;
	filename: string;
	labels: Array<{ span: { line: number; column: number } }>;
}

interface OxlintOutput {
	diagnostics: OxlintDiagnostic[];
}

const resolveOxlintBinary = (): string => {
	try {
		const oxlintMainPath = esmRequire.resolve("oxlint");
		const oxlintDir = path.resolve(path.dirname(oxlintMainPath), "..");
		return path.join(oxlintDir, "bin", "oxlint");
	} catch {
		return "oxlint";
	}
};

const VITE_QUERY_RE = /["'][^"']*\?(worker|sharedworker|worker-url|url|raw|inline|init)\b/;
const isViteVirtualImportFalsePositive = (rule: string, message: string): boolean =>
	rule.startsWith("import/") && VITE_QUERY_RE.test(message);

const AMBIENT_GLOBAL_DEPS = ["unplugin-icons", "@types/bun", "bun-types"] as const;
type AmbientSource = (typeof AMBIENT_GLOBAL_DEPS)[number];

const SST_PLATFORM_REF_RE =
	/\/\/\/\s*<reference\s+path=["'][^"']*sst[\\/]+platform[\\/]+config\.d\.ts["']/;

const ICON_AUTOIMPORT_RE = /^Icon[A-Z]/;
const NO_UNDEF_IDENT_RE = /^['‘"`]([^'’"`]+)['’"`]/;

const detectAmbientSources = (rootDir: string): Set<AmbientSource> => {
	const found = new Set<AmbientSource>();
	const skipDirs = new Set([
		"node_modules",
		".git",
		"dist",
		"build",
		"out",
		"target",
		"coverage",
		".next",
		".turbo",
	]);
	const walk = (dir: string, depth: number): void => {
		if (depth > 4 || found.size === AMBIENT_GLOBAL_DEPS.length) return;
		let entries: import("node:fs").Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (found.size === AMBIENT_GLOBAL_DEPS.length) return;
			if (entry.name.startsWith(".") && entry.name !== ".github") continue;
			if (skipDirs.has(entry.name)) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full, depth + 1);
			} else if (entry.name === "package.json") {
				try {
					const pkg = JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
					const allDeps = {
						...((pkg.dependencies ?? {}) as Record<string, unknown>),
						...((pkg.devDependencies ?? {}) as Record<string, unknown>),
						...((pkg.peerDependencies ?? {}) as Record<string, unknown>),
					};
					for (const dep of AMBIENT_GLOBAL_DEPS) {
						if (dep in allDeps) found.add(dep);
					}
				} catch {
					// ignore
				}
			}
		}
	};
	walk(rootDir, 0);
	return found;
};

const extractNoUndefIdentifier = (message: string): string | null => {
	const match = NO_UNDEF_IDENT_RE.exec(message);
	return match?.[1] ?? null;
};

const isAmbientFalsePositive = (
	rule: string,
	message: string,
	sources: Set<AmbientSource>,
): boolean => {
	if (rule !== "eslint/no-undef") return false;
	const ident = extractNoUndefIdentifier(message);
	if (!ident) return false;
	if (sources.has("unplugin-icons") && ICON_AUTOIMPORT_RE.test(ident)) return true;
	if ((sources.has("@types/bun") || sources.has("bun-types")) && ident === "Bun") return true;
	return false;
};

const sstReferencedFiles = new Map<string, boolean>();
const fileReferencesSstPlatform = (rootDir: string, relativeFilePath: string): boolean => {
	const cached = sstReferencedFiles.get(relativeFilePath);
	if (cached !== undefined) return cached;
	const absolute = path.isAbsolute(relativeFilePath)
		? relativeFilePath
		: path.join(rootDir, relativeFilePath);
	let referenced = false;
	try {
		const fd = fs.openSync(absolute, "r");
		try {
			const buf = Buffer.alloc(512);
			const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
			referenced = SST_PLATFORM_REF_RE.test(buf.toString("utf-8", 0, bytesRead));
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		referenced = false;
	}
	sstReferencedFiles.set(relativeFilePath, referenced);
	return referenced;
};

const UNUSED_VAR_IDENT_RE =
	/(?:Variable|Parameter|Catch parameter) '([^']+)' (?:is declared but never used|is caught but never used)/;
const isUnderscoreUnusedVar = (rule: string, message: string): boolean => {
	if (rule !== "eslint/no-unused-vars") return false;
	const match = UNUSED_VAR_IDENT_RE.exec(message);
	return match ? match[1].startsWith("_") : false;
};

const parseRuleCode = (code: string | null | undefined): { plugin: string; rule: string } => {
	if (!code) return { plugin: "eslint", rule: "syntax-error" };
	const match = code.match(/^(.+)\((.+)\)$/);
	if (!match) {
		// Plain code without parentheses (e.g. compile errors) — use "eslint" as default plugin
		return { plugin: "eslint", rule: code };
	}
	return { plugin: match[1].replace(/^eslint-plugin-/, ""), rule: match[2] };
};

const detectTestFramework = (rootDir: string): TestFramework => {
	try {
		const raw = fs.readFileSync(path.join(rootDir, "package.json"), "utf-8");
		const pkg = JSON.parse(raw) as Record<string, Record<string, string>>;
		const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

		if (allDeps.vitest) return "vitest";
		if (allDeps.jest || allDeps["ts-jest"] || allDeps["@jest/core"]) return "jest";
		if (allDeps.mocha) return "mocha";

		if (
			fs.existsSync(path.join(rootDir, "jest.config.js")) ||
			fs.existsSync(path.join(rootDir, "jest.config.ts")) ||
			fs.existsSync(path.join(rootDir, "jest.config.mjs"))
		)
			return "jest";
		if (
			fs.existsSync(path.join(rootDir, "vitest.config.ts")) ||
			fs.existsSync(path.join(rootDir, "vitest.config.js"))
		)
			return "vitest";
		if (fs.existsSync(path.join(rootDir, ".mocharc.yml"))) return "mocha";
	} catch {
		// ignore
	}
	return null;
};

interface UnusedVarCandidate {
	filePath: string;
	line: number;
	column: number;
	name: string;
	type: "variable" | "parameter";
}

const extractUnusedVarName = (
	message: string,
): { name: string; type: "variable" | "parameter" } | null => {
	const variableMatch = message.match(/Variable '([^']+)' is declared but never used/);
	if (variableMatch?.[1]) return { name: variableMatch[1], type: "variable" };

	const paramMatch = message.match(/Parameter '([^']+)' is declared but never used/);
	if (paramMatch?.[1]) return { name: paramMatch[1], type: "parameter" };

	const catchMatch = message.match(/Catch parameter '([^']+)' is caught but never used/);
	if (catchMatch?.[1]) return { name: catchMatch[1], type: "parameter" };

	return null;
};

const collectUnusedVarCandidates = (diagnostics: Diagnostic[]): UnusedVarCandidate[] =>
	diagnostics
		.filter((d) => d.rule === "eslint/no-unused-vars")
		.map((d) => {
			const extracted = extractUnusedVarName(d.message);
			if (!extracted || extracted.name.startsWith("_")) return null;
			return {
				filePath: d.filePath,
				line: d.line,
				column: d.column,
				name: extracted.name,
				type: extracted.type,
			};
		})
		.filter((candidate): candidate is UnusedVarCandidate => candidate !== null);

const removeDuplicateKeyLines = (rootDirectory: string, diagnostics: Diagnostic[]): void => {
	const byFile = new Map<string, { key: string; line: number }[]>();

	for (const d of diagnostics) {
		const keyMatch = d.message.match(/Duplicate key '([^']+)'/);
		if (!keyMatch) continue;
		const absolute = path.isAbsolute(d.filePath)
			? d.filePath
			: path.join(rootDirectory, d.filePath);
		const entries = byFile.get(absolute) ?? [];
		entries.push({ key: keyMatch[1], line: d.line });
		byFile.set(absolute, entries);
	}

	for (const [filePath, dupes] of byFile) {
		if (!fs.existsSync(filePath)) continue;
		const content = fs.readFileSync(filePath, "utf-8");
		const lines = content.split("\n");
		const toRemove = new Set<number>();

		for (const { key } of dupes) {
			const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const keyPattern = new RegExp(`^\\s*['"]?${escaped}['"]?\\s*:|^\\s*${escaped}\\s*:`);

			const matches: number[] = [];
			for (let i = 0; i < lines.length; i++) {
				if (keyPattern.test(lines[i])) {
					matches.push(i);
				}
			}

			for (let j = 1; j < matches.length; j++) {
				toRemove.add(matches[j]);
			}
		}

		if (toRemove.size === 0) continue;
		const filtered = lines.filter((_, i) => !toRemove.has(i));
		fs.writeFileSync(filePath, filtered.join("\n"));
	}
};

export const runOxlint = async (context: EngineContext): Promise<Diagnostic[]> => {
	const configPath = path.join(os.tmpdir(), `aislop-oxlintrc-${process.pid}.json`);
	const framework = context.frameworks.find((f) => f !== "none");
	const testFramework = detectTestFramework(context.rootDirectory);
	const config = createOxlintConfig({ framework, testFramework });
	const ambientSources = detectAmbientSources(context.rootDirectory);
	sstReferencedFiles.clear();

	try {
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

		const binary = resolveOxlintBinary();
		const args = [binary, "-c", configPath, "--format", "json"];

		const hasTs = context.languages.includes("typescript");
		if (hasTs && fs.existsSync(path.join(context.rootDirectory, "tsconfig.json"))) {
			args.push("--tsconfig", "./tsconfig.json");
		}

		args.push(".");

		const result = await runSubprocess(process.execPath, args, {
			cwd: context.rootDirectory,
			timeout: 120000,
		});

		if (!result.stdout) return [];

		let output: OxlintOutput;
		try {
			output = JSON.parse(result.stdout) as OxlintOutput;
		} catch {
			return [];
		}

		const seen = new Set<string>();
		return output.diagnostics
			.map((d) => {
				const { plugin, rule } = parseRuleCode(d.code);
				const label = d.labels[0];

				return {
					filePath: d.filename,
					engine: "lint" as const,
					rule: `${plugin}/${rule}`,
					severity: d.severity,
					message: d.message.replace(/\S+\.\w+:\d+:\d+[\s\S]*$/, "").trim() || d.message,
					help: d.help || "",
					line: label?.span.line ?? 0,
					column: label?.span.column ?? 0,
					category: plugin === "react" ? "React" : plugin === "import" ? "Imports" : "Lint",
					fixable: false,
				};
			})
			.filter((d) => {
				const relativePath = path.isAbsolute(d.filePath)
					? path.relative(context.rootDirectory, d.filePath)
					: d.filePath;
				if (isExcludedFromScan(relativePath)) return false;
				if (isViteVirtualImportFalsePositive(d.rule, d.message)) return false;
				if (isAmbientFalsePositive(d.rule, d.message, ambientSources)) return false;
				if (isUnderscoreUnusedVar(d.rule, d.message)) return false;
				if (
					d.rule === "eslint/no-undef" &&
					fileReferencesSstPlatform(context.rootDirectory, d.filePath)
				) {
					return false;
				}
				const key = `${d.filePath}:${d.line}:${d.rule}:${d.message}`;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
	} finally {
		if (fs.existsSync(configPath)) {
			fs.unlinkSync(configPath);
		}
	}
};

export const fixOxlint = async (
	context: EngineContext,
	options: { force?: boolean } = {},
): Promise<void> => {
	const dangerous = options.force ?? false;
	const configPath = path.join(os.tmpdir(), `aislop-oxlintrc-fix-${process.pid}.json`);
	const framework = context.frameworks.find((f) => f !== "none");
	const testFramework = detectTestFramework(context.rootDirectory);
	const config = createOxlintConfig({ framework, testFramework, mode: "fix" });

	try {
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

		const binary = resolveOxlintBinary();
		const args = dangerous
			? [binary, "-c", configPath, "--fix", "--fix-suggestions", "--fix-dangerously", "."]
			: [binary, "-c", configPath, "--fix", "."];

		const result = await runSubprocess(process.execPath, args, {
			cwd: context.rootDirectory,
			timeout: 120000,
		});

		if (result.exitCode !== 0) {
			throw new Error(
				result.stderr || result.stdout || `Oxlint exited with code ${result.exitCode}`,
			);
		}

		const remaining = await runOxlint(context);
		const candidates = collectUnusedVarCandidates(remaining);
		if (candidates.length > 0) {
			const targets: UnusedVarTarget[] = candidates.map((c) => ({
				filePath: path.isAbsolute(c.filePath)
					? c.filePath
					: path.join(context.rootDirectory, c.filePath),
				line: c.line,
				column: c.column,
				name: c.name,
				type: c.type,
			}));
			prefixUnusedVars(context.rootDirectory, targets);
		}

		const duplicateKeys = remaining.filter((d) => d.message.startsWith("Duplicate key"));
		if (duplicateKeys.length > 0) {
			removeDuplicateKeyLines(context.rootDirectory, duplicateKeys);
		}
	} finally {
		if (fs.existsSync(configPath)) {
			fs.unlinkSync(configPath);
		}
	}
};

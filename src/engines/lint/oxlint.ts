import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { runSubprocess } from "../../utils/subprocess.js";
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

		// Check for jest in config files
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

const prefixIdentifierOnLine = (
	line: string,
	name: string,
	column: number,
	type: "variable" | "parameter",
): string => {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	if (type === "parameter") {
		const destructureMatch = line.match(/\{[^}]*\}/);
		if (destructureMatch) {
			const { 0: content, index: start } = destructureMatch;
			const propPattern = new RegExp(`(?<!:\\s*)\\b${escaped}\\b(?!\\s*:)`);
			if (propPattern.test(content)) {
				const updated = content.replace(propPattern, `${name}: _${name}`);
				if (updated !== content) {
					return line.slice(0, start!) + updated + line.slice(start! + content.length);
				}
			}
		}
		const paramPattern = new RegExp(`\\b${escaped}\\b`);
		return paramPattern.test(line) ? line.replace(paramPattern, `_${name}`) : line;
	}

	// For top-level `const|let|var name = ...` declarations we deliberately do
	// NOT rewrite: either strip the line or rewrite the initializer as a bare
	// expression. Both are destructive and can produce an illegal statement
	// (e.g. leaving `return x * 2;` in module scope). That category is now
	// owned by `removeUnusedDeclarations` (code-quality engine), which parses
	// with the TypeScript compiler, runs a side-effect guard, and verifies the
	// file still parses before writing. Fall through to identifier-prefix logic
	// so the declaration becomes `const _name = ...` — safe and reversible.
	const destructureMatch = line.match(/\{[^}]*\}/);
	if (destructureMatch) {
		const { 0: content, index: start } = destructureMatch;
		if (new RegExp(`\\b${escaped}\\b`).test(content)) {
			let updated = content.replace(new RegExp(`\\b${escaped}\\b\\s*,?`), "");
			updated = updated
				.replace(/,\s*\},/, "}")
				.replace(/\{,\s*/, "{")
				.replace(/\s*,\s*\}/, "}");
			if (updated !== content) {
				return line.slice(0, start!) + updated + line.slice(start! + content.length);
			}
		}
	}

	let bestStart = -1;
	let bestEnd = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	const target = Math.max(0, column - 1);

	for (const match of line.matchAll(new RegExp(`\\b${escaped}\\b`, "g"))) {
		if (match.index === undefined) continue;
		const start = match.index;
		const end = start + name.length;
		if (start > 0 && line[start - 1] === "_") continue;

		const distance = target >= start && target <= end ? 0 : Math.abs(start - target);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestStart = start;
			bestEnd = end;
		}
	}

	if (bestStart < 0 || bestEnd < 0) return line;

	return `${line.slice(0, bestStart)}_${name}${line.slice(bestEnd)}`;
};

const applyUnusedVarPrefixFixes = (
	rootDirectory: string,
	candidates: UnusedVarCandidate[],
): void => {
	const byFile = new Map<string, UnusedVarCandidate[]>();

	for (const candidate of candidates) {
		const absolute = path.isAbsolute(candidate.filePath)
			? candidate.filePath
			: path.join(rootDirectory, candidate.filePath);
		const entries = byFile.get(absolute) ?? [];
		entries.push(candidate);
		byFile.set(absolute, entries);
	}

	for (const [filePath, fileCandidates] of byFile.entries()) {
		if (!fs.existsSync(filePath)) continue;
		const content = fs.readFileSync(filePath, "utf-8");
		const lines = content.split("\n");

		const ordered = [...fileCandidates].sort((a, b) => {
			if (a.line !== b.line) return a.line - b.line;
			return a.column - b.column;
		});

		let changed = false;
		for (const candidate of ordered) {
			const lineIndex = candidate.line - 1;
			if (lineIndex < 0 || lineIndex >= lines.length) continue;
			const current = lines[lineIndex];
			const updated = prefixIdentifierOnLine(
				current,
				candidate.name,
				candidate.column,
				candidate.type,
			);
			if (updated !== current) {
				lines[lineIndex] = updated;
				changed = true;
			}
		}

		if (changed) {
			fs.writeFileSync(filePath, lines.join("\n"));
		}
	}
};

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
		// Safe mode: only apply fixes oxlint considers non-breaking.
		// Dangerous mode (fix -f / --force): also apply suggestion-level and
		// dangerous fixes — e.g. deleting unused arrow-function declarations,
		// which can leave files syntactically broken if the body outlives the
		// signature.
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
			applyUnusedVarPrefixFixes(context.rootDirectory, candidates);
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

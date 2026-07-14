import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { dropGitIgnoredPaths } from "../../utils/git-ignore.js";
import { relativePosix } from "../../utils/paths.js";
import { parseJsonc } from "../../utils/read-jsonc.js";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";

const MAX_DEPTH = 3;
const TSC_TIMEOUT_MS = 120_000;
const esmRequire = createRequire(import.meta.url);
// tsc non-pretty output: `path/to/file.ts(line,col): error TSnnnn: message`
const TSC_LINE_RE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/;

export const findTsconfigs = (root: string): string[] => {
	const results: string[] = [];
	const walk = (dir: string, depth: number) => {
		if (depth > MAX_DEPTH) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full, depth + 1);
			else if (entry.name === "tsconfig.json") results.push(full);
		}
	};
	walk(root, 0);
	// Honor .gitignore: the raw walk would otherwise run tsc on tsconfigs under ignored
	// directories (spikes, scratch checkouts) that the git-aware source scan already skips,
	// flooding the report with type errors from code that was never meant to ship.
	return dropGitIgnoredPaths(root, results);
};

export const resolveTrustedTscPath = (): string | null => {
	try {
		return esmRequire.resolve("typescript/lib/tsc.js");
	} catch {
		return null;
	}
};

// Reference-only configs (only `references`, no `files`/`include`/`extends`) should be skipped;
// tsc exits with "No inputs were found" and the error is noise, not a finding.
const isReferenceOnlyConfig = (tsconfigPath: string): boolean => {
	try {
		const raw = fs.readFileSync(tsconfigPath, "utf-8");
		const parsed = parseJsonc(raw) as {
			references?: unknown;
			files?: unknown;
			include?: unknown;
			extends?: unknown;
		} | null;
		if (!parsed) return false;
		return Array.isArray(parsed.references) && !parsed.files && !parsed.include && !parsed.extends;
	} catch {
		return false;
	}
};

export const runTypecheck = async (context: EngineContext): Promise<Diagnostic[]> => {
	const tsconfigs = findTsconfigs(context.rootDirectory).filter((p) => !isReferenceOnlyConfig(p));
	if (tsconfigs.length === 0) return [];

	const diagnostics: Diagnostic[] = [];
	const seen = new Set<string>();

	const tscCli = resolveTrustedTscPath();
	if (!tscCli) return [];

	for (const tsconfig of tsconfigs) {
		const projectDir = path.dirname(tsconfig);

		let output = "";
		try {
			const result = await runSubprocess(
				process.execPath,
				[tscCli, "--noEmit", "--pretty", "false", "-p", tsconfig],
				{ cwd: projectDir, timeout: TSC_TIMEOUT_MS },
			);
			output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
		} catch {
			continue;
		}

		for (const rawLine of output.split("\n")) {
			const line = rawLine.trim();
			if (!line) continue;
			const match = TSC_LINE_RE.exec(line);
			if (!match) continue;
			const [, filePath, lineStr, colStr, severity, code, message] = match;
			const absolute = path.resolve(projectDir, filePath);
			const relative = relativePosix(context.rootDirectory, absolute);
			const key = `${relative}:${lineStr}:${colStr}:TS${code}`;
			if (seen.has(key)) continue;
			seen.add(key);
			diagnostics.push({
				filePath: relative,
				engine: "lint",
				rule: `typescript/TS${code}`,
				severity: severity === "error" ? "error" : "warning",
				message,
				help: `Fix the underlying type — TS${code} is a hard contract violation, not a style nit.`,
				line: Number.parseInt(lineStr, 10),
				column: Number.parseInt(colStr, 10),
				category: "TypeScript",
				fixable: false,
			});
		}
	}

	return diagnostics;
};

import type { ChangeContext, Diagnostic } from "../engines/types.js";
import { projectRelativePosix, toPosix } from "./paths.js";

export type ChangedLines =
	| { readonly kind: "all" }
	| { readonly kind: "hunks"; readonly ranges: ReadonlyArray<{ start: number; end: number }> };

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const stripDiffPrefix = (filePath: string): string => {
	if (filePath === "/dev/null") return filePath;
	return filePath.replace(/^[ab]\//, "");
};

const parseHunkRange = (
	startText: string,
	countText: string | undefined,
): { start: number; end: number } | null => {
	const start = Number(startText);
	const count = countText === undefined ? 1 : Number(countText);
	if (!Number.isFinite(start) || !Number.isFinite(count) || count <= 0) return null;
	return { start, end: start + count - 1 };
};

// git writes "+++ a/path", "+++ b/path" or "+++ /dev/null"; a bare "+++ " is content.
const FILE_HEADER_RE = /^\+\+\+ (?:[ab]\/|\/dev\/null$)/;

export const parseUnifiedDiffHunks = (diff: string): Map<string, ChangedLines> => {
	const byFile = new Map<string, { start: number; end: number }[]>();
	let current: string | null = null;

	// Inside a hunk body an added line is written "+<content>", so content beginning with
	// "++ " reproduces a "+++ " header. Only trust the header before the first hunk.
	let inHunkBody = false;

	for (const raw of diff.split(/\r?\n/)) {
		if (raw.startsWith("diff --git ") || raw.startsWith("rename to ")) {
			inHunkBody = false;
		}
		if (raw.startsWith("rename to ")) {
			current = toPosix(raw.slice("rename to ".length).trim());
			if (current && !byFile.has(current)) byFile.set(current, []);
			continue;
		}
		if (!inHunkBody && FILE_HEADER_RE.test(raw)) {
			const name = stripDiffPrefix(raw.slice(4).trim());
			current = name === "/dev/null" ? null : toPosix(name);
			if (current && !byFile.has(current)) byFile.set(current, []);
			continue;
		}
		if (!current) continue;
		const match = HUNK_RE.exec(raw);
		if (!match) {
			continue;
		}
		inHunkBody = true;
		const range = parseHunkRange(match[3], match[4]);
		if (!range) continue;
		const ranges = byFile.get(current);
		if (ranges) ranges.push(range);
	}

	const result = new Map<string, ChangedLines>();
	for (const [filePath, ranges] of byFile) {
		result.set(filePath, { kind: "hunks", ranges });
	}
	return result;
};

const lookupChangedLines = (
	map: Map<string, ChangedLines>,
	rootDirectory: string,
	filePath: string,
): ChangedLines | undefined => {
	const slashPath = filePath.split("\\").join("/");
	const relative = projectRelativePosix(rootDirectory, slashPath);
	return map.get(relative) ?? map.get(toPosix(slashPath)) ?? map.get(slashPath);
};

export const classifyChangeContext = (
	diagnostic: Diagnostic,
	map: Map<string, ChangedLines>,
	rootDirectory: string,
): ChangeContext => {
	if (diagnostic.line <= 0) return "unknown";
	const entry = lookupChangedLines(map, rootDirectory, diagnostic.filePath);
	if (!entry) return "unknown";
	if (entry.kind === "all") return "changed-line";
	if (
		entry.ranges.some((range) => diagnostic.line >= range.start && diagnostic.line <= range.end)
	) {
		return "changed-line";
	}
	return "existing-file-context";
};

export const applyChangeContext = (
	diagnostics: Diagnostic[],
	map: Map<string, ChangedLines>,
	rootDirectory: string,
): Diagnostic[] =>
	diagnostics.map((diagnostic) => ({
		...diagnostic,
		changeContext: classifyChangeContext(diagnostic, map, rootDirectory),
	}));

export const changeContextOrder = (context: ChangeContext | undefined): number => {
	if (context === "changed-line") return 0;
	if (context === "existing-file-context") return 1;
	return 2;
};

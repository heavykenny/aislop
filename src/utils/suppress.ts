import fs from "node:fs";
import path from "node:path";
import type { Diagnostic, EngineResult } from "../engines/types.js";

// Directives are only honored when they appear in an actual comment segment.
// Inline comments are found by scanning outside common string literal delimiters
// so text like "https://aislop-ignore-file" cannot hide diagnostics.
const DIRECTIVE_RE = /^\s*(?:\/\/|\/\*+|#|<!--|\*)\s*aislop-ignore-(next-line|line|file)\b([^\n]*)/;
const INLINE_COMMENT_MARKERS = ["//", "/*", "#", "<!--"] as const;

export const isAislopDirectiveLine = (line: string): boolean => findDirective(line) !== null;

type SuppressScope = "next-line" | "line" | "file";

interface Directive {
	rules: Set<string>;
	all: boolean;
}

interface FileDirectives {
	file: Directive[];
	byLine: Map<number, Directive[]>;
}

const findDirective = (line: string): RegExpExecArray | null => {
	const leading = DIRECTIVE_RE.exec(line);
	if (leading) return leading;

	let quote: '"' | "'" | "`" | null = null;
	let escaped = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (quote) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === quote) {
				quote = null;
			}
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			continue;
		}
		if (INLINE_COMMENT_MARKERS.some((marker) => line.startsWith(marker, i))) {
			const match = DIRECTIVE_RE.exec(line.slice(i));
			if (match) return match;
		}
	}
	return null;
};

const parseDirective = (rest: string): Directive => {
	const beforeReason = rest.split("--")[0];
	const tokens = beforeReason.match(/[A-Za-z0-9@][\w@/.-]*/g) ?? [];
	if (tokens.length === 0) return { rules: new Set(), all: true };
	return { rules: new Set(tokens), all: false };
};

const covers = (directive: Directive, rule: string): boolean =>
	directive.all || [...directive.rules].some((r) => r === rule || rule.endsWith(`/${r}`));

const parseFileDirectives = (content: string): FileDirectives => {
	const lines = content.split(/\r?\n/);
	const file: Directive[] = [];
	const byLine = new Map<number, Directive[]>();
	const addLine = (target: number, directive: Directive) => {
		const list = byLine.get(target) ?? [];
		list.push(directive);
		byLine.set(target, list);
	};
	for (let i = 0; i < lines.length; i++) {
		const match = findDirective(lines[i]);
		if (!match) continue;
		const scope = match[1] as SuppressScope;
		const directive = parseDirective(match[2] ?? "");
		if (scope === "file") file.push(directive);
		else if (scope === "next-line") addLine(i + 2, directive);
		else addLine(i + 1, directive);
	}
	return { file, byLine };
};

export const applySuppressions = (
	results: EngineResult[],
	rootDirectory: string,
): { results: EngineResult[]; suppressedCount: number } => {
	const cache = new Map<string, FileDirectives | null>();
	let suppressedCount = 0;

	const load = (filePath: string): FileDirectives | null => {
		const cached = cache.get(filePath);
		if (cached !== undefined) return cached;
		const absolute = path.isAbsolute(filePath) ? filePath : path.join(rootDirectory, filePath);
		let parsed: FileDirectives | null = null;
		try {
			parsed = parseFileDirectives(fs.readFileSync(absolute, "utf-8"));
		} catch {
			parsed = null;
		}
		cache.set(filePath, parsed);
		return parsed;
	};

	const isSuppressed = (diagnostic: Diagnostic): boolean => {
		const directives = load(diagnostic.filePath);
		if (!directives) return false;
		if (directives.file.some((d) => covers(d, diagnostic.rule))) return true;
		const onLine = directives.byLine.get(diagnostic.line) ?? [];
		return onLine.some((d) => covers(d, diagnostic.rule));
	};

	const filtered = results.map((result) => {
		const kept = result.diagnostics.filter((diagnostic) => {
			if (isSuppressed(diagnostic)) {
				suppressedCount += 1;
				return false;
			}
			return true;
		});
		return { ...result, diagnostics: kept };
	});

	return { results: filtered, suppressedCount };
};

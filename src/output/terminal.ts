import type { Diagnostic, EngineResult } from "../engines/types.js";
import { log } from "../ui/logger.js";
import { symbols } from "../ui/symbols.js";
import { style, theme } from "../ui/theme.js";
import { getEngineLabel } from "./engine-info.js";

const groupBy = <T>(items: T[], key: (item: T) => string): Map<string, T[]> => {
	const map = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const group = map.get(k) ?? [];
		group.push(item);
		map.set(k, group);
	}
	return map;
};

const colorBySeverity = (text: string, severity: string): string =>
	severity === "error" ? style(theme, "danger", text) : style(theme, "warn", text);

const toElapsedLabel = (elapsedMs: number): string =>
	elapsedMs < 1000 ? `${Math.round(elapsedMs)}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;

const toSeverityLabel = (severity: Diagnostic["severity"]): string => {
	if (severity === "error") return "ERROR";
	if (severity === "warning") return "WARN";
	return "INFO";
};

const toLocationLabel = (diagnostic: Diagnostic): string => {
	const line = diagnostic.line > 0 ? `:${diagnostic.line}` : "";
	const column = diagnostic.column > 0 ? `:${diagnostic.column}` : "";
	return `${diagnostic.filePath}${line}${column}`;
};

const wrapText = (
	text: string,
	maxWidth: number,
	firstIndentWidth: number,
	contIndent: string,
): string[] => {
	const firstWidth = Math.max(20, maxWidth - firstIndentWidth);
	const contWidth = Math.max(20, maxWidth - contIndent.length);
	const words = text.split(/\s+/).filter((w) => w.length > 0);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const budget = lines.length === 0 ? firstWidth : contWidth;
		if (current.length === 0) {
			current = word;
		} else if (current.length + 1 + word.length <= budget) {
			current = `${current} ${word}`;
		} else {
			lines.push(current);
			current = word;
		}
	}
	if (current.length > 0) lines.push(current);
	return lines.map((line, i) => (i === 0 ? line : `${contIndent}${line}`));
};

const wrapHelpText = (text: string, maxWidth: number, indent: string): string[] => {
	const segments = wrapText(text, maxWidth, indent.length, indent);
	// The first segment has no prefix; help lines always start at the indent.
	return segments.map((seg, i) => (i === 0 ? `${indent}${seg}` : seg));
};

const terminalWidth = (): number => {
	const raw = process.stdout.columns;
	if (typeof raw !== "number" || raw <= 0) return 100;
	return Math.min(raw, 100);
};

export const renderDiagnostics = (diagnostics: Diagnostic[], verbose: boolean): string => {
	const lines: string[] = [];
	const byEngine = groupBy(diagnostics, (d) => d.engine);

	for (const [engine, engineDiags] of byEngine) {
		const label = getEngineLabel(engine as Diagnostic["engine"]);
		lines.push(`  ${style(theme, "bold", `${symbols.engineActive} ${label}`)}`);

		const byRule = groupBy(engineDiags, (d) => `${d.rule}:${d.message}`);
		const sorted = [...byRule.entries()].sort(([, a], [, b]) => {
			const sa = a[0].severity === "error" ? 0 : a[0].severity === "warning" ? 1 : 2;
			const sb = b[0].severity === "error" ? 0 : b[0].severity === "warning" ? 1 : 2;
			return sa - sb;
		});

		for (const [, ruleDiags] of sorted) {
			const first = ruleDiags[0];
			const level = toSeverityLabel(first.severity);
			const count = ruleDiags.length > 1 ? ` (${ruleDiags.length})` : "";
			const status = colorBySeverity(level, first.severity);
			const fixableTag = first.fixable ? ` ${style(theme, "muted", "[auto]")}` : "";
			const fixableWidth = first.fixable ? " [auto]".length : 0;

			const badgePrefix = `    [${status}]${fixableTag} `;
			const badgePrefixWidth = 4 + 1 + level.length + 1 + fixableWidth + 1;
			const messageText = `${first.message}${count}`;
			const wrappedMsg = wrapText(messageText, terminalWidth(), badgePrefixWidth, "      ");
			lines.push(`${badgePrefix}${wrappedMsg[0]}`);
			for (let i = 1; i < wrappedMsg.length; i++) {
				lines.push(wrappedMsg[i]);
			}

			const locations = verbose ? ruleDiags : ruleDiags.slice(0, 3);
			for (const diagnostic of locations) {
				lines.push(style(theme, "muted", `      ${toLocationLabel(diagnostic)}`));
			}
			if (!verbose && ruleDiags.length > locations.length) {
				lines.push(
					style(
						theme,
						"muted",
						`      +${ruleDiags.length - locations.length} more location(s), use -d for full list`,
					),
				);
			}

			if (first.help) {
				const wrapped = wrapHelpText(first.help, terminalWidth(), "      ");
				for (const line of wrapped) {
					lines.push(style(theme, "muted", line));
				}
			}

			lines.push("");
		}
	}

	return `${lines.join("\n")}\n`;
};

export const printEngineStatus = (result: EngineResult): void => {
	const label = getEngineLabel(result.engine);
	const elapsed = toElapsedLabel(result.elapsed);

	if (result.skipped) {
		log.warn(`${label}: skipped${result.skipReason ? ` (${result.skipReason})` : ""}`);
	} else if (result.diagnostics.length === 0) {
		log.success(`${label}: done (0 issues, ${elapsed})`);
	} else {
		const errors = result.diagnostics.filter((d) => d.severity === "error").length;
		const warnings = result.diagnostics.filter((d) => d.severity === "warning").length;
		const parts: string[] = [];
		if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
		if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
		const statusText = `${parts.join(", ")}, ${elapsed}`;

		if (errors > 0) {
			log.error(`${label}: done (${statusText})`);
		} else {
			log.warn(`${label}: done (${statusText})`);
		}
	}
};

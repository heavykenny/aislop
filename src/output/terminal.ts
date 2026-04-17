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

			lines.push(`    [${status}] ${first.message}${count}`);

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
				lines.push(style(theme, "muted", `      ${first.help}`));
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

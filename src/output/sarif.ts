import path from "node:path";
import type { Diagnostic, EngineResult, Severity } from "../engines/types.js";
import { APP_VERSION } from "../version.js";

const SARIF_VERSION = "2.1.0";
const SARIF_SCHEMA =
	"https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

type SarifLevel = "error" | "warning" | "note";

interface SarifReportingDescriptor {
	id: string;
	name?: string;
	shortDescription?: { text: string };
	helpUri?: string;
	help?: { text: string };
}

interface SarifResult {
	ruleId: string;
	ruleIndex: number;
	level: SarifLevel;
	message: { text: string };
	locations: Array<{
		physicalLocation: {
			artifactLocation: { uri: string };
			region: { startLine: number; startColumn: number };
		};
	}>;
}

interface SarifLog {
	$schema: string;
	version: string;
	runs: Array<{
		tool: {
			driver: {
				name: string;
				version: string;
				informationUri: string;
				rules: SarifReportingDescriptor[];
			};
		};
		results: SarifResult[];
	}>;
}

const levelFromSeverity = (severity: Severity): SarifLevel => {
	if (severity === "error") return "error";
	if (severity === "warning") return "warning";
	return "note";
};

// SARIF regions are 1-based; clamp engine output that may emit 0 to keep validators happy.
const oneBased = (value: number): number => (value >= 1 ? value : 1);

const toUri = (filePath: string): string => filePath.split(path.sep).join("/");

const buildRules = (diagnostics: Diagnostic[]): SarifReportingDescriptor[] => {
	const byId = new Map<string, SarifReportingDescriptor>();
	for (const d of diagnostics) {
		if (byId.has(d.rule)) continue;
		byId.set(d.rule, {
			id: d.rule,
			name: d.rule,
			shortDescription: { text: d.message },
			help: { text: d.help || d.message },
		});
	}
	return [...byId.values()];
};

export const buildSarifLog = (results: EngineResult[]): SarifLog => {
	const diagnostics = results.flatMap((r) => r.diagnostics);
	const rules = buildRules(diagnostics);
	const ruleIndex = new Map(rules.map((rule, index) => [rule.id, index]));

	const sarifResults: SarifResult[] = diagnostics.map((d) => ({
		ruleId: d.rule,
		ruleIndex: ruleIndex.get(d.rule) ?? 0,
		level: levelFromSeverity(d.severity),
		message: { text: d.message },
		locations: [
			{
				physicalLocation: {
					artifactLocation: { uri: toUri(d.filePath) },
					region: { startLine: oneBased(d.line), startColumn: oneBased(d.column) },
				},
			},
		],
	}));

	return {
		$schema: SARIF_SCHEMA,
		version: SARIF_VERSION,
		runs: [
			{
				tool: {
					driver: {
						name: "aislop",
						version: APP_VERSION,
						informationUri: "https://github.com/scanaislop/aislop",
						rules,
					},
				},
				results: sarifResults,
			},
		],
	};
};

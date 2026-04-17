import type { Diagnostic, EngineContext } from "../types.js";
import { runOxlint } from "../lint/oxlint.js";
import { runKnip } from "./knip.js";
import type { UnusedDeclaration, UnusedKind } from "./unused-removal-types.js";

const KNIP_MESSAGE_KIND: Record<string, UnusedKind> = {
	"knip/exports": "variable",
	"knip/types": "type",
	"knip/duplicates": "variable",
};

const extractNameFromKnip = (message: string): string | null => {
	const match = message.match(/^(?:Unused export|Unused type|Duplicate export):\s*(.+)$/);
	return match?.[1]?.trim() ?? null;
};

const extractNameAndKindFromOxlint = (
	message: string,
): { name: string; kind: UnusedKind } | null => {
	// Variable 'x' is declared but never used.
	const varMatch = message.match(/Variable '([^']+)' is declared but never used/);
	if (varMatch?.[1]) return { name: varMatch[1], kind: "variable" };
	// Function 'foo' is declared but never used. (oxlint may not emit this exact
	// form; we still handle it defensively.)
	const funcMatch = message.match(/Function '([^']+)' is declared but never used/);
	if (funcMatch?.[1]) return { name: funcMatch[1], kind: "function" };
	// Class 'Foo' is declared but never used.
	const classMatch = message.match(/Class '([^']+)' is declared but never used/);
	if (classMatch?.[1]) return { name: classMatch[1], kind: "class" };
	// TS-rule style: 'Foo' is declared but its value is never read.
	const tsValueMatch = message.match(/'([^']+)' is declared but its value is never read/);
	if (tsValueMatch?.[1]) return { name: tsValueMatch[1], kind: "variable" };
	// TS-rule style: 'Foo' is defined but never used.
	const identMatch = message.match(/'([^']+)' is (?:defined|declared) but never used/);
	if (identMatch?.[1]) return { name: identMatch[1], kind: "variable" };
	return null;
};

/**
 * oxlint may emit no-unused-vars under several rule codes depending on which
 * plugin catches it (eslint, typescript-eslint, unicorn in some configs, etc.).
 * Any rule whose local name is `no-unused-vars` applies.
 */
const isUnusedVarRule = (rule: string): boolean =>
	rule === "no-unused-vars" || rule.endsWith("/no-unused-vars");

/**
 * Merge oxlint + knip detection output into a single list of unused
 * top-level declarations that our remover can process.
 *
 * oxlint contributes `no-unused-vars` diagnostics (local top-level decls)
 * under whichever plugin caught them (`eslint/no-unused-vars`,
 * `typescript/no-unused-vars`, …). knip contributes `knip/exports`,
 * `knip/types`, `knip/duplicates` — symbols that were exported but are
 * unused by any importer. The removal engine strips the whole declaration
 * (including the `export` keyword) in one pass; knip's `--fix` is no longer
 * invoked, so the engine owns the complete operation.
 */
export const detectUnusedDeclarations = async (context: EngineContext): Promise<Diagnostic[]> => {
	const [oxlintDiagnostics, knipDiagnostics] = await Promise.all([
		runOxlint(context).catch(() => [] as Diagnostic[]),
		runKnip(context.rootDirectory).catch(() => [] as Diagnostic[]),
	]);

	const merged: Diagnostic[] = [];

	for (const d of oxlintDiagnostics) {
		if (!isUnusedVarRule(d.rule)) continue;
		const extracted = extractNameAndKindFromOxlint(d.message);
		if (!extracted) continue;
		// oxlint reports parameter-only unused names too; skip if prefixed.
		if (extracted.name.startsWith("_")) continue;
		merged.push({
			filePath: d.filePath,
			engine: "code-quality",
			rule: "code-quality/unused-declaration",
			severity: "warning",
			message: `Unused ${extracted.kind}: ${extracted.name}`,
			help: "This top-level declaration is never used; aislop will remove it.",
			line: d.line,
			column: d.column,
			category: "Dead Code",
			fixable: true,
		});
	}

	for (const d of knipDiagnostics) {
		if (!(d.rule in KNIP_MESSAGE_KIND)) continue;
		const name = extractNameFromKnip(d.message);
		if (!name) continue;
		const kind = KNIP_MESSAGE_KIND[d.rule];
		merged.push({
			filePath: d.filePath,
			engine: "code-quality",
			rule: "code-quality/unused-declaration",
			severity: "warning",
			message: `Unused ${kind}: ${name}`,
			help: "This top-level declaration is never imported; aislop will remove it.",
			line: d.line,
			column: d.column,
			category: "Dead Code",
			fixable: true,
		});
	}

	// Dedupe by file+line+name.
	const seen = new Set<string>();
	return merged.filter((d) => {
		const key = `${d.filePath}:${d.line}:${d.message}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

/**
 * Convert the detection diagnostics produced above into UnusedDeclaration
 * records the remover can consume.
 */
export const diagnosticsToDeclarations = (diagnostics: Diagnostic[]): UnusedDeclaration[] => {
	const result: UnusedDeclaration[] = [];
	for (const d of diagnostics) {
		const match = d.message.match(/^Unused (\w+): (.+)$/);
		if (!match) continue;
		const [, kindWord, name] = match;
		if (
			kindWord !== "variable" &&
			kindWord !== "function" &&
			kindWord !== "class" &&
			kindWord !== "type" &&
			kindWord !== "interface" &&
			kindWord !== "enum"
		) {
			continue;
		}
		result.push({
			filePath: d.filePath,
			line: d.line,
			column: d.column,
			name: name.trim(),
			kind: kindWord as UnusedKind,
		});
	}
	return result;
};

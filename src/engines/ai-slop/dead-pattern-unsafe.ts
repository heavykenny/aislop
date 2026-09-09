import type { Diagnostic } from "../types.js";
import { slop } from "./dead-pattern-diagnostic.js";
import { isNonProductionPath } from "./non-production-paths.js";

const asAnyPattern = new RegExp(`\\b${"a" + "s"}\\s+${"an" + "y"}\\b`);
const doubleAssertPattern = new RegExp(`\\b${"a" + "s"}\\s+${"unkn" + "own"}\\s+${"a" + "s"}\\s+`);

interface UnsafeTypeFinding {
	rule: string;
	severity: Diagnostic["severity"];
	message: string;
	help: string;
}

const unsafeTypeDiagnostic = (
	filePath: string,
	line: number,
	finding: UnsafeTypeFinding,
): Diagnostic =>
	slop(filePath, line, finding.rule, finding.severity, finding.message, finding.help, false);

export const detectUnsafeTypePatterns = (
	content: string,
	relativePath: string,
	ext: string,
): Diagnostic[] => {
	if (ext !== ".ts" && ext !== ".tsx") return [];
	if (isNonProductionPath(relativePath)) return [];

	const diagnostics: Diagnostic[] = [];
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();

		// Check ts-directives BEFORE skipping comments, since the directives are comments.
		if (
			/\/\/\s*@ts-(?:ignore|expect-error)/.test(trimmed) ||
			/\/\*\s*@ts-(?:ignore|expect-error)/.test(trimmed)
		) {
			diagnostics.push(
				unsafeTypeDiagnostic(relativePath, i + 1, {
					rule: "ai-slop/ts-directive",
					severity: "info",
					message: "@ts-ignore/@ts-expect-error suppresses type checking — review if still needed",
					help: "Fix the underlying type issue instead of suppressing the error",
				}),
			);
		}

		if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

		if (/\bRegExp\b|new\s+RegExp|\/.*\\b/.test(trimmed)) continue;
		if (/["'`].*\\b.*["'`]/.test(trimmed)) continue;

		if (asAnyPattern.test(trimmed)) {
			diagnostics.push(
				unsafeTypeDiagnostic(relativePath, i + 1, {
					rule: "ai-slop/unsafe-type-assertion",
					severity: "warning",
					message: `'${"as" + " any"}' bypasses type safety`,
					help: "Use a proper type or a more specific assertion",
				}),
			);
		}

		if (doubleAssertPattern.test(trimmed)) {
			const isOrmReturn =
				/\.query[(<]/.test(trimmed) || /result\[0\]/.test(trimmed) || /rows\s/.test(trimmed);
			if (!isOrmReturn) {
				diagnostics.push(
					unsafeTypeDiagnostic(relativePath, i + 1, {
						rule: "ai-slop/double-type-assertion",
						severity: "warning",
						message: `Double type assertion (${"as" + " unknown as"} X) bypasses type checking`,
						help: "Refactor to avoid needing a double assertion. If this is an ORM query return, consider a typed wrapper function",
					}),
				);
			}
		}
	}

	return diagnostics;
};

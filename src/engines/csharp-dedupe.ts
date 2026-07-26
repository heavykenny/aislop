import type { EngineResult } from "./types.js";

const APPROXIMATE_RULES = new Set(["ai-slop/csharp-async-void", "ai-slop/csharp-sync-over-async"]);

// When the dotnet lint engine reports an accurate async diagnostic at a given
// file:line, suppress the Phase 1 regex approximation at the same location so the
// user never sees both the heuristic and the authoritative finding.
export const dedupeCSharpAsync = (results: EngineResult[]): EngineResult[] => {
	const dotnetLocations = new Set<string>();
	for (const result of results) {
		if (result.engine !== "lint") continue;
		for (const diagnostic of result.diagnostics) {
			if (diagnostic.rule.startsWith("dotnet/")) {
				dotnetLocations.add(`${diagnostic.filePath}:${diagnostic.line}`);
			}
		}
	}
	if (dotnetLocations.size === 0) return results;

	return results.map((result) => {
		if (result.engine !== "ai-slop") return result;
		return {
			...result,
			diagnostics: result.diagnostics.filter(
				(diagnostic) =>
					!(
						APPROXIMATE_RULES.has(diagnostic.rule) &&
						dotnetLocations.has(`${diagnostic.filePath}:${diagnostic.line}`)
					),
			),
		};
	});
};

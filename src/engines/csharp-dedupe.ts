import type { EngineResult } from "./types.js";

// Maps each Phase 1 regex approximation to the exact dotnet/* rule ids that
// represent the same heuristic. A coincidental file:line overlap with an
// unrelated dotnet rule (say CS0219 or IDISP001) must not suppress the
// approximation; only these authoritative rules may.
const AUTHORITATIVE_RULES: Record<string, ReadonlySet<string>> = {
	// AsyncFixer03: fire-and-forget async void methods and delegates.
	"ai-slop/csharp-async-void": new Set(["dotnet/AsyncFixer03"]),
	// AsyncFixer02: blocking/synchronous calls inside an async method.
	// MA0042/MA0045: Meziantou rules for blocking calls in (or convertible to) an async method.
	"ai-slop/csharp-sync-over-async": new Set(["dotnet/AsyncFixer02", "dotnet/MA0042", "dotnet/MA0045"]),
};

// When the dotnet lint engine reports an accurate async diagnostic at a given
// file:line, suppress the Phase 1 regex approximation at the same location so the
// user never sees both the heuristic and the authoritative finding.
export const dedupeCSharpAsync = (results: EngineResult[]): EngineResult[] => {
	const dotnetRulesByLocation = new Map<string, Set<string>>();
	for (const result of results) {
		if (result.engine !== "lint") continue;
		for (const diagnostic of result.diagnostics) {
			if (!diagnostic.rule.startsWith("dotnet/")) continue;
			const location = `${diagnostic.filePath}:${diagnostic.line}`;
			const rulesAtLocation = dotnetRulesByLocation.get(location) ?? new Set<string>();
			rulesAtLocation.add(diagnostic.rule);
			dotnetRulesByLocation.set(location, rulesAtLocation);
		}
	}
	if (dotnetRulesByLocation.size === 0) return results;

	return results.map((result) => {
		if (result.engine !== "ai-slop") return result;
		return {
			...result,
			diagnostics: result.diagnostics.filter((diagnostic) => {
				const authoritativeRules = AUTHORITATIVE_RULES[diagnostic.rule];
				if (!authoritativeRules) return true;
				const rulesAtLocation = dotnetRulesByLocation.get(`${diagnostic.filePath}:${diagnostic.line}`);
				if (!rulesAtLocation) return true;
				for (const rule of rulesAtLocation) {
					if (authoritativeRules.has(rule)) return false;
				}
				return true;
			}),
		};
	});
};

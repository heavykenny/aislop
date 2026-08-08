import { describe, expect, it } from "vitest";
import { dedupeCsharpDiagnostics } from "../../src/engines/lint/index.js";
import type { Diagnostic } from "../../src/engines/types.js";

const makeDiagnostic = (overrides: Pick<Diagnostic, "filePath" | "line" | "rule">): Diagnostic => ({
	engine: "lint",
	category: "C# Lint",
	severity: "warning",
	message: "test message",
	help: "",
	column: 1,
	fixable: false,
	...overrides,
});

describe("dedupeCsharpDiagnostics", () => {
	it("(a) collapses Windows-vs-Unix path variants of the same file+line+ruleId to one entry, keeping the jb copy", () => {
		const windowsPath = makeDiagnostic({
			filePath: "src\\App\\Service.cs",
			line: 10,
			rule: "jb/CS0219",
		});
		const unixPath = makeDiagnostic({
			filePath: "src/App/Service.cs",
			line: 10,
			rule: "dotnet/CS0219",
		});
		const result = dedupeCsharpDiagnostics([windowsPath, unixPath]);
		expect(result).toHaveLength(1);
		// The jb copy is kept because it appears first in the input.
		expect(result[0].rule).toBe("jb/CS0219");
	});

	it("(b) keeps diagnostics with the same bare rule id when they are in different files", () => {
		const fileA = makeDiagnostic({ filePath: "src/A.cs", line: 10, rule: "jb/CS0219" });
		const fileB = makeDiagnostic({ filePath: "src/B.cs", line: 10, rule: "dotnet/CS0219" });
		const result = dedupeCsharpDiagnostics([fileA, fileB]);
		expect(result).toHaveLength(2);
	});

	it("(c) keeps diagnostics with the same bare rule id in the same file but on different lines", () => {
		const line10 = makeDiagnostic({ filePath: "src/App/Service.cs", line: 10, rule: "jb/CS0219" });
		const line20 = makeDiagnostic({
			filePath: "src/App/Service.cs",
			line: 20,
			rule: "dotnet/CS0219",
		});
		const result = dedupeCsharpDiagnostics([line10, line20]);
		expect(result).toHaveLength(2);
	});

	it("(d) keeps two diagnostics at the same file+line when they have different bare rule ids", () => {
		const jbRule = makeDiagnostic({
			filePath: "src/App/Service.cs",
			line: 5,
			rule: "jb/RedundantUsingDirective",
		});
		const dotnetRule = makeDiagnostic({
			filePath: "src/App/Service.cs",
			line: 5,
			rule: "dotnet/SomethingElse",
		});
		const result = dedupeCsharpDiagnostics([jbRule, dotnetRule]);
		expect(result).toHaveLength(2);
	});
});

import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/engines/types.js";
import { buildFeedback } from "../../src/hooks/feedback.js";

const diag = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
	filePath: "/repo/src/x.ts",
	engine: "ai-slop",
	rule: "ai-slop/as-any-cast",
	severity: "warning",
	message: "replace the `as any`",
	help: "",
	line: 10,
	column: 4,
	category: "AI Slop",
	fixable: false,
	...overrides,
});

describe("buildFeedback", () => {
	it("converts absolute diagnostic paths to repo-relative", () => {
		const fb = buildFeedback([diag()], 82, "/repo");
		expect(fb.findings[0].file).toBe("src/x.ts");
	});

	it("counts errors, warnings, fixables, total", () => {
		const ds = [
			diag({ severity: "error" }),
			diag({ severity: "warning", fixable: true }),
			diag({ severity: "warning" }),
		];
		const fb = buildFeedback(ds, 60, "/repo");
		expect(fb.counts.error).toBe(1);
		expect(fb.counts.warning).toBe(2);
		expect(fb.counts.fixable).toBe(1);
		expect(fb.counts.total).toBe(3);
	});

	it("marks regressed=true when score < baseline", () => {
		const fb = buildFeedback([diag()], 70, "/repo", 85);
		expect(fb.regressed).toBe(true);
		expect(fb.baseline).toBe(85);
	});

	it("caps findings at 20 and reports elided count", () => {
		const ds = Array.from({ length: 25 }, () => diag());
		const fb = buildFeedback(ds, 40, "/repo");
		expect(fb.findings).toHaveLength(20);
		expect(fb.elided).toBe(5);
	});

	it("drops info-level diagnostics from findings", () => {
		const ds = [diag({ severity: "info" }), diag()];
		const fb = buildFeedback(ds, 82, "/repo");
		expect(fb.findings).toHaveLength(1);
	});

	it("stamps schema identifier", () => {
		const fb = buildFeedback([], 100, "/repo");
		expect(fb.schema).toBe("aislop.hook.v1");
	});
});

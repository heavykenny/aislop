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

	it("marks regressed=true when score < baseline (number form)", () => {
		const fb = buildFeedback([diag()], 70, "/repo", 85);
		expect(fb.regressed).toBe(true);
		expect(fb.baseline).toBe(85);
		expect(fb.delta).toBe(-15);
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

	it("stamps schema identifier as v2", () => {
		const fb = buildFeedback([], 100, "/repo");
		expect(fb.schema).toBe("aislop.hook.v2");
	});

	it("includes accountability metadata when hook adapters pass agent context", () => {
		const fb = buildFeedback([diag({ severity: "error" })], 80, "/repo", undefined, {
			agent: "claude",
			touchedFiles: ["src/x.ts"],
		});
		expect(fb.accountability).toMatchObject({
			agent: "claude",
			touchedFiles: ["src/x.ts"],
			mustFixBeforeDone: true,
		});
		expect(fb.accountability?.reason).toContain("Error-severity");
	});
});

describe("buildFeedback v2 — delta + newSinceBaseline + suggestedActions", () => {
	it("computes positive delta on improvement; suggestedActions emits no_action", () => {
		const fb = buildFeedback([], 92, "/repo", { score: 80, findingFingerprints: [] });
		expect(fb.delta).toBe(12);
		expect(fb.regressed).toBe(false);
		expect(fb.suggestedActions[0].id).toBe("no_action");
		expect(fb.suggestedActions[0].label).toContain("Score improved by 12");
	});

	it("computes zero delta when score matches baseline", () => {
		const fb = buildFeedback([], 90, "/repo", { score: 90, findingFingerprints: [] });
		expect(fb.delta).toBe(0);
		expect(fb.regressed).toBe(false);
	});

	it("populates newSinceBaseline with findings whose fingerprint isn't in the snapshot", () => {
		const carryOver = diag({ filePath: "/repo/src/old.ts", line: 5, rule: "ai-slop/foo" });
		const fresh = diag({ filePath: "/repo/src/new.ts", line: 10, rule: "ai-slop/bar" });
		const fb = buildFeedback([carryOver, fresh], 75, "/repo", {
			score: 90,
			findingFingerprints: ["src/old.ts:5:ai-slop/foo"],
		});
		expect(fb.newSinceBaseline).toBeDefined();
		expect(fb.newSinceBaseline).toHaveLength(1);
		expect(fb.newSinceBaseline?.[0].file).toBe("src/new.ts");
	});

	it("leaves newSinceBaseline undefined when baseline has no fingerprints recorded", () => {
		const fb = buildFeedback([diag()], 80, "/repo", { score: 90, findingFingerprints: [] });
		expect(fb.newSinceBaseline).toBeUndefined();
	});

	it("suggestedActions emits run_aislop_fix when there are fixable findings", () => {
		const fb = buildFeedback([diag({ fixable: true })], 80, "/repo");
		const fix = fb.suggestedActions.find((a) => a.id === "run_aislop_fix");
		expect(fix).toBeDefined();
		expect(fix?.command).toBe("aislop fix");
	});

	it("suggestedActions emits review_finding for arch/* errors (not auto-fixable)", () => {
		const archErr = diag({
			rule: "arch/no-cross-layer-imports",
			severity: "error",
			category: "Architecture",
		});
		const fb = buildFeedback([archErr], 80, "/repo");
		const review = fb.suggestedActions.find((a) => a.id === "review_finding");
		expect(review).toBeDefined();
		expect(review?.ruleIds).toContain("arch/no-cross-layer-imports");
	});

	it("suggestedActions emits review_finding when score regressed by ≥5 with no fixable", () => {
		const fb = buildFeedback([diag()], 80, "/repo", { score: 90, findingFingerprints: [] });
		const review = fb.suggestedActions.find((a) => a.id === "review_finding");
		expect(review).toBeDefined();
		expect(review?.label).toContain("Score dropped 10 points");
	});

	it("suggestedActions stays at no_action on a small regression with no fixable", () => {
		const fb = buildFeedback([diag()], 88, "/repo", { score: 90, findingFingerprints: [] });
		// regressed=true, but delta=-2 is below the ≥5 review threshold and no fixable
		expect(fb.suggestedActions.map((a) => a.id)).toEqual(["no_action"]);
	});

	it("keeps v1's nextSteps populated for back-compat consumers", () => {
		const fb = buildFeedback([diag({ severity: "error" })], 60, "/repo");
		expect(fb.nextSteps.length).toBeGreaterThan(0);
		expect(fb.nextSteps[0]).toMatch(/^Fix 1 error/);
	});
});

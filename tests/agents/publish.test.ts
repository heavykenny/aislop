import { describe, expect, it } from "vitest";
import { buildPrBody, normalizeBranchName } from "../../src/agents/publish.js";

describe("agent publish helpers", () => {
	it("normalizes branch names for local agent publish", () => {
		expect(normalizeBranchName("  aislop agent repair!  ")).toBe("aislop-agent-repair");
		expect(normalizeBranchName("feature///cleanup")).toBe("feature/cleanup");
		expect(normalizeBranchName("")).toMatch(/^aislop\/agent-/);
	});

	it("builds a reviewable PR body with score and verification", () => {
		const body = buildPrBody({
			providerId: "codex",
			beforeScore: 82,
			afterScore: 93,
			changedFiles: ["src/a.ts", "src/b.ts"],
		});

		expect(body).toContain("generated locally by `aislop agent`");
		expect(body).toContain("Provider: codex");
		expect(body).toContain("Score: 82 -> 93");
		expect(body).toContain("- src/a.ts");
		expect(body).toContain("aislop scan --json");
	});
});

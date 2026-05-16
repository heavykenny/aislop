import { describe, expect, it } from "vitest";
import { redactProperties } from "../../src/telemetry/redaction.js";

describe("redactProperties", () => {
	it("keeps allowlisted properties", () => {
		const { clean, dropped } = redactProperties({
			aislop_version: "1.0.0",
			command: "scan",
			score: 90,
		});
		expect(clean).toEqual({
			aislop_version: "1.0.0",
			command: "scan",
			score: 90,
		});
		expect(dropped).toEqual([]);
	});

	it("drops non-allowlisted properties", () => {
		const { clean, dropped } = redactProperties({
			aislop_version: "1.0.0",
			file_path: "/Users/me/secrets.env",
			repo_name: "my-repo",
		});
		expect(clean).toEqual({ aislop_version: "1.0.0" });
		expect(dropped.sort()).toEqual(["file_path", "repo_name"]);
	});

	it("skips undefined values", () => {
		const { clean } = redactProperties({
			command: "scan",
			score: undefined,
		});
		expect(clean).toEqual({ command: "scan" });
	});

	it("preserves boolean and zero values", () => {
		const { clean } = redactProperties({
			is_ci: false,
			score: 0,
			ok: true,
		});
		expect(clean).toEqual({ is_ci: false, score: 0, ok: true });
	});
});

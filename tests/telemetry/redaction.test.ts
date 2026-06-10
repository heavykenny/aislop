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

	it("keeps aggregate agent telemetry without allowing paths", () => {
		const { clean, dropped } = redactProperties({
			command: "agent",
			provider: "codex",
			provider_source: "preference",
			target_score: 90,
			max_turns: 4,
			finding_limit: 8,
			worktree_mode: "isolated",
			apply_requested: true,
			publish_mode: "pr",
			agent_result: "completed",
			score_before: 84,
			score_after: 94,
			score_delta: 10,
			changed_files: 3,
			provider_passes: 2,
			tool_calls: 5,
			total_tokens: 1234,
			cost_usd: 0.04,
			session_path: ".aislop/agent/sessions/secret.jsonl",
		});
		expect(clean).toMatchObject({
			command: "agent",
			provider: "codex",
			provider_source: "preference",
			target_score: 90,
			agent_result: "completed",
			score_before: 84,
			score_after: 94,
			score_delta: 10,
			changed_files: 3,
		});
		expect(dropped).toEqual(["session_path"]);
	});
});

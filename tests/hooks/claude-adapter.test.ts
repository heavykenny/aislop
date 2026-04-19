import { describe, expect, it } from "vitest";
import {
	parseClaudeStdin,
	renderClaudeOutput,
} from "../../src/hooks/adapters/claude.js";

describe("parseClaudeStdin", () => {
	it("returns {} for empty input", () => {
		expect(parseClaudeStdin("")).toEqual({});
		expect(parseClaudeStdin("   ")).toEqual({});
	});

	it("returns {} for malformed JSON", () => {
		expect(parseClaudeStdin("not json")).toEqual({});
	});

	it("parses a PostToolUse Edit payload", () => {
		const raw = JSON.stringify({
			hook_event_name: "PostToolUse",
			tool_name: "Edit",
			tool_input: { file_path: "/abs/file.ts" },
			cwd: "/abs",
		});
		const parsed = parseClaudeStdin(raw);
		expect(parsed.tool_name).toBe("Edit");
		expect(parsed.tool_input?.file_path).toBe("/abs/file.ts");
	});
});

describe("renderClaudeOutput", () => {
	it("wraps additionalContext in the PostToolUse envelope", () => {
		const out = renderClaudeOutput('{"score":90}');
		expect(out.hookSpecificOutput.hookEventName).toBe("PostToolUse");
		expect(out.hookSpecificOutput.additionalContext).toBe('{"score":90}');
		expect(out.decision).toBeUndefined();
	});

	it("emits block decision with reason when provided", () => {
		const out = renderClaudeOutput('{"score":40}', { reason: "regressed" });
		expect(out.decision).toBe("block");
		expect(out.reason).toBe("regressed");
	});
});

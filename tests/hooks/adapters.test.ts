import { describe, expect, it } from "vitest";
import {
	parseClaudeFileChangedStdin,
	parseClaudeStdin,
	parseClaudeStopStdin,
	renderClaudeOutput,
} from "../../src/hooks/adapters/claude.js";
import { parseCursorStdin, renderCursorOutput } from "../../src/hooks/adapters/cursor.js";
import { parseGeminiStdin, renderGeminiOutput } from "../../src/hooks/adapters/gemini.js";

describe("Claude adapter", () => {
	it("parses PostToolUse Edit payload", () => {
		const parsed = parseClaudeStdin(
			JSON.stringify({ tool_name: "Edit", tool_input: { file_path: "/abs/a.ts" } }),
		);
		expect(parsed.tool_input?.file_path).toBe("/abs/a.ts");
	});

	it("renders block envelope with reason", () => {
		const out = renderClaudeOutput("{}", { reason: "drop" });
		expect(out.decision).toBe("block");
		expect(out.reason).toBe("drop");
	});

	it("parses Stop payload with stop_hook_active flag", () => {
		const parsed = parseClaudeStopStdin(JSON.stringify({ stop_hook_active: true }));
		expect(parsed.stop_hook_active).toBe(true);
	});

	it("parses FileChanged payload with file_path + cwd", () => {
		const parsed = parseClaudeFileChangedStdin(
			JSON.stringify({ cwd: "/repo", file_path: "/repo/.aislop/config.yml" }),
		);
		expect(parsed.cwd).toBe("/repo");
		expect(parsed.file_path).toBe("/repo/.aislop/config.yml");
	});

	it("FileChanged parser returns empty object on garbage stdin", () => {
		expect(parseClaudeFileChangedStdin("")).toEqual({});
		expect(parseClaudeFileChangedStdin("not json")).toEqual({});
	});
});

describe("Cursor adapter", () => {
	it("extracts file_path from flat stdin", () => {
		const parsed = parseCursorStdin(JSON.stringify({ file_path: "/abs/a.ts" }));
		expect(parsed.file_path).toBe("/abs/a.ts");
	});

	it("renders afterFileEdit envelope", () => {
		const out = renderCursorOutput('{"score":80}');
		expect(out.hookSpecificOutput.hookEventName).toBe("afterFileEdit");
	});
});

describe("Gemini adapter", () => {
	it("extracts file_path from tool_input", () => {
		const parsed = parseGeminiStdin(
			JSON.stringify({ tool_name: "write_file", tool_input: { file_path: "/abs/a.ts" } }),
		);
		expect(parsed.tool_input?.file_path).toBe("/abs/a.ts");
	});

	it("renders AfterTool envelope", () => {
		const out = renderGeminiOutput('{"score":80}');
		expect(out.hookSpecificOutput.hookEventName).toBe("AfterTool");
	});
});

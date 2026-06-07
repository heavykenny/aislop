import { describe, expect, it } from "vitest";
import { formatProviderOutputLine } from "../../src/agents/provider-output.js";

describe("provider output formatting", () => {
	it("passes through plain text provider output", () => {
		expect(formatProviderOutputLine("edited src/a.ts")).toBe("edited src/a.ts");
	});

	it("summarizes assistant JSON content", () => {
		expect(
			formatProviderOutputLine(
				JSON.stringify({
					type: "assistant",
					message: { content: [{ type: "text", text: "I fixed the import." }] },
				}),
			),
		).toBe("assistant: I fixed the import.");
	});

	it("summarizes tool and command JSON events", () => {
		expect(
			formatProviderOutputLine(
				JSON.stringify({
					type: "assistant",
					message: { content: [{ type: "tool_use", name: "Edit" }] },
				}),
			),
		).toBe("tool: Edit");
		expect(formatProviderOutputLine(JSON.stringify({ type: "exec", command: "pnpm test" }))).toBe(
			"exec: pnpm test",
		);
	});

	it("summarizes provider lifecycle events", () => {
		expect(formatProviderOutputLine(JSON.stringify({ type: "system", subtype: "init" }))).toBe(
			"session initialized",
		);
		expect(formatProviderOutputLine(JSON.stringify({ type: "result", subtype: "success" }))).toBe(
			"result: success",
		);
	});
});

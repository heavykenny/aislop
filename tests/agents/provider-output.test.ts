import { describe, expect, it } from "vitest";
import { extractProviderOutputMetadata } from "../../src/agents/provider-metadata.js";
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

	it("extracts token usage and file paths from provider JSON", () => {
		const metadata = extractProviderOutputMetadata(
			JSON.stringify({
				type: "turn.completed",
				usage: {
					input_tokens: 1200,
					cached_input_tokens: 400,
					output_tokens: 80,
				},
				item: {
					type: "file_change",
					path: "src/app.ts",
				},
			}),
		);

		expect(metadata.usage).toMatchObject({
			inputTokens: 1200,
			cachedInputTokens: 400,
			outputTokens: 80,
			totalTokens: 1680,
		});
		expect(metadata.files).toEqual(["src/app.ts"]);
	});

	it("does not create zero-token usage for command-only events", () => {
		const metadata = extractProviderOutputMetadata(
			JSON.stringify({
				type: "item.completed",
				command: "sed -n 1,80p src/app.ts",
			}),
		);

		expect(metadata.usage).toBeUndefined();
	});

	it("extracts Claude-style final cost and cache token usage", () => {
		const metadata = extractProviderOutputMetadata(
			JSON.stringify({
				type: "result",
				total_cost_usd: 0.0123,
				usage: {
					input_tokens: 100,
					cache_read_input_tokens: 250,
					cache_creation_input_tokens: 50,
					output_tokens: 25,
				},
			}),
		);

		expect(metadata.usage).toMatchObject({
			inputTokens: 100,
			cachedInputTokens: 300,
			outputTokens: 25,
			totalTokens: 425,
			costUsd: 0.0123,
		});
	});
});

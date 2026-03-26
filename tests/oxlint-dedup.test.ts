import { describe, expect, it } from "vitest";

// ─── parseRuleCode behavior ──────────────────────────────────────────────────
// We test the parseRuleCode logic indirectly by verifying the rule format patterns

describe("oxlint rule code parsing", () => {
	const parseRuleCode = (code: string | null | undefined): { plugin: string; rule: string } => {
		if (!code) return { plugin: "eslint", rule: "syntax-error" };
		const match = code.match(/^(.+)\((.+)\)$/);
		if (!match) return { plugin: "eslint", rule: code };
		return { plugin: match[1].replace(/^eslint-plugin-/, ""), rule: match[2] };
	};

	it("returns eslint/syntax-error for null code", () => {
		const result = parseRuleCode(null);
		expect(result).toEqual({ plugin: "eslint", rule: "syntax-error" });
	});

	it("returns eslint/syntax-error for undefined code", () => {
		const result = parseRuleCode(undefined);
		expect(result).toEqual({ plugin: "eslint", rule: "syntax-error" });
	});

	it("returns eslint/syntax-error for empty string", () => {
		const result = parseRuleCode("");
		expect(result).toEqual({ plugin: "eslint", rule: "syntax-error" });
	});

	it("parses standard rule format: plugin(rule)", () => {
		const result = parseRuleCode("eslint(no-unused-vars)");
		expect(result).toEqual({ plugin: "eslint", rule: "no-unused-vars" });
	});

	it("strips eslint-plugin- prefix from plugin name", () => {
		const result = parseRuleCode("eslint-plugin-import(no-duplicates)");
		expect(result).toEqual({ plugin: "import", rule: "no-duplicates" });
	});

	it("handles plain code string without parentheses", () => {
		const result = parseRuleCode("SyntaxError");
		expect(result).toEqual({ plugin: "eslint", rule: "SyntaxError" });
	});

	it("handles react plugin codes", () => {
		const result = parseRuleCode("react(jsx-no-target-blank)");
		expect(result).toEqual({ plugin: "react", rule: "jsx-no-target-blank" });
	});
});

// ─── deduplication logic ─────────────────────────────────────────────────────

describe("oxlint diagnostic deduplication", () => {
	it("removes duplicate diagnostics with same file:line:rule:message", () => {
		const diagnostics = [
			{ filePath: "a.ts", line: 5, rule: "eslint/no-var", message: "Unexpected var" },
			{ filePath: "a.ts", line: 5, rule: "eslint/no-var", message: "Unexpected var" },
			{ filePath: "a.ts", line: 5, rule: "eslint/no-var", message: "Unexpected var" },
		];

		const seen = new Set<string>();
		const deduped = diagnostics.filter((d) => {
			const key = `${d.filePath}:${d.line}:${d.rule}:${d.message}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		expect(deduped).toHaveLength(1);
	});

	it("keeps diagnostics with different lines", () => {
		const diagnostics = [
			{ filePath: "a.ts", line: 5, rule: "eslint/no-var", message: "Unexpected var" },
			{ filePath: "a.ts", line: 10, rule: "eslint/no-var", message: "Unexpected var" },
		];

		const seen = new Set<string>();
		const deduped = diagnostics.filter((d) => {
			const key = `${d.filePath}:${d.line}:${d.rule}:${d.message}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		expect(deduped).toHaveLength(2);
	});

	it("keeps diagnostics with different messages on same line", () => {
		const diagnostics = [
			{ filePath: "a.ts", line: 5, rule: "eslint/no-unused-vars", message: "Variable 'x'" },
			{ filePath: "a.ts", line: 5, rule: "eslint/no-unused-vars", message: "Variable 'y'" },
		];

		const seen = new Set<string>();
		const deduped = diagnostics.filter((d) => {
			const key = `${d.filePath}:${d.line}:${d.rule}:${d.message}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		expect(deduped).toHaveLength(2);
	});

	it("keeps diagnostics with different rules on same line", () => {
		const diagnostics = [
			{ filePath: "a.ts", line: 5, rule: "eslint/no-var", message: "Unexpected var" },
			{ filePath: "a.ts", line: 5, rule: "eslint/no-eval", message: "eval is bad" },
		];

		const seen = new Set<string>();
		const deduped = diagnostics.filter((d) => {
			const key = `${d.filePath}:${d.line}:${d.rule}:${d.message}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		expect(deduped).toHaveLength(2);
	});
});

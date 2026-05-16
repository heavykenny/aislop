import { describe, expect, it } from "vitest";
import { buildLanguageProperties } from "../../src/telemetry/language.js";

describe("buildLanguageProperties", () => {
	it("returns empty summary and all-false flags for no languages", () => {
		expect(buildLanguageProperties([])).toEqual({
			language_summary: "",
			lang_typescript: false,
			lang_javascript: false,
			lang_python: false,
			lang_java: false,
		});
	});

	it("sorts languages alphabetically in the summary", () => {
		expect(buildLanguageProperties(["typescript", "python"]).language_summary).toBe(
			"python,typescript",
		);
	});

	it("sets per-language flags correctly", () => {
		const props = buildLanguageProperties(["typescript", "java"]);
		expect(props.lang_typescript).toBe(true);
		expect(props.lang_java).toBe(true);
		expect(props.lang_javascript).toBe(false);
		expect(props.lang_python).toBe(false);
	});

	it("ignores unknown languages", () => {
		const props = buildLanguageProperties(["typescript", "ruby", "rust"]);
		expect(props.language_summary).toBe("typescript");
	});

	it("deduplicates repeated languages", () => {
		const props = buildLanguageProperties(["typescript", "typescript", "python"]);
		expect(props.language_summary).toBe("python,typescript");
	});
});

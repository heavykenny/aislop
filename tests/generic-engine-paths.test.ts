import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineContext } from "../src/engines/types.js";
import type { Language } from "../src/utils/discover.js";

const { runSubprocess } = vi.hoisted(() => ({ runSubprocess: vi.fn() }));

vi.mock("../src/utils/subprocess.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/utils/subprocess.js")>();
	return { ...actual, runSubprocess };
});

const { runGenericFormatter } = await import("../src/engines/format/generic.js");
const { runGenericLinter } = await import("../src/engines/lint/generic.js");

const rootDirectory = path.resolve("project-root");
const context: EngineContext = {
	rootDirectory,
	languages: [],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
};

beforeEach(() => {
	runSubprocess.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("generic engine diagnostic paths", () => {
	it.each<[Language, string, string]>([
		["rust", "src/lib.rs", `Diff in ${path.join("src", "lib.rs")} at line 3:`],
		[
			"ruby",
			"app/main.rb",
			JSON.stringify({
				files: [
					{
						path: path.join("app", "main.rb"),
						offenses: [{ cop_name: "Layout/Space", message: "spacing" }],
					},
				],
			}),
		],
		[
			"php",
			"src/index.php",
			JSON.stringify({ files: [{ name: path.join("src", "index.php") }] }),
		],
	])("normalizes %s formatter output", async (language, expectedPath, output) => {
		runSubprocess.mockResolvedValue({ stdout: output, stderr: output, exitCode: 1 });

		const diagnostics = await runGenericFormatter(context, language);
		expect(diagnostics[0]?.filePath).toBe(expectedPath);
	});

	it("normalizes Clippy output", async () => {
		runSubprocess.mockResolvedValue({
			stdout: JSON.stringify({
				reason: "compiler-message",
				message: {
					code: { code: "clippy::example" },
					level: "warning",
					message: "example",
					spans: [{ file_name: path.join("src", "lib.rs"), line_start: 4 }],
				},
			}),
			stderr: "",
			exitCode: 1,
		});

		const diagnostics = await runGenericLinter(context, "rust");
		expect(diagnostics[0]?.filePath).toBe("src/lib.rs");
	});

	it("normalizes a namespaced absolute Windows rustfmt path", async () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		runSubprocess.mockResolvedValue({
			stdout: "Diff in \\\\?\\C:\\repo\\src\\lib.rs at line 3:",
			stderr: "",
			exitCode: 1,
		});

		const diagnostics = await runGenericFormatter(
			{ ...context, rootDirectory: "C:\\repo" },
			"rust",
		);
		expect(diagnostics[0]?.filePath).toBe("src/lib.rs");
	});

	it("normalizes RuboCop output", async () => {
		runSubprocess.mockResolvedValue({
			stdout: JSON.stringify({
				files: [
					{
						path: path.join("app", "main.rb"),
						offenses: [
							{ cop_name: "Style/Example", severity: "warning", message: "example" },
						],
					},
				],
			}),
			stderr: "",
			exitCode: 1,
		});

		const diagnostics = await runGenericLinter(context, "ruby");
		expect(diagnostics[0]?.filePath).toBe("app/main.rb");
	});
});

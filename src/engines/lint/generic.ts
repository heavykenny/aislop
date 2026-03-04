import type { Language } from "../../utils/discover.js";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";

export const runGenericLinter = async (
	context: EngineContext,
	language: Language,
): Promise<Diagnostic[]> => {
	switch (language) {
		case "rust":
			return runClippy(context);
		case "ruby":
			return runRubocop(context);
		default:
			return [];
	}
};

const runClippy = async (context: EngineContext): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess(
			"cargo",
			["clippy", "--message-format=json", "--quiet"],
			{ cwd: context.rootDirectory, timeout: 120000 },
		);

		const diagnostics: Diagnostic[] = [];
		const lines = result.stdout.split("\n").filter((l) => l.startsWith("{"));

		for (const line of lines) {
			try {
				const msg = JSON.parse(line);
				if (msg.reason !== "compiler-message" || !msg.message) continue;
				const m = msg.message;
				const span = m.spans?.[0];

				diagnostics.push({
					filePath: span?.file_name ?? "",
					engine: "lint",
					rule: `clippy/${m.code?.code ?? "unknown"}`,
					severity: m.level === "error" ? "error" : "warning",
					message: m.message ?? "",
					help: m.children?.[0]?.message ?? "",
					line: span?.line_start ?? 0,
					column: span?.column_start ?? 0,
					category: "Rust Lint",
					fixable: false,
				});
			} catch {
				continue;
			}
		}

		return diagnostics;
	} catch {
		return [];
	}
};

const runRubocop = async (context: EngineContext): Promise<Diagnostic[]> => {
	try {
		const result = await runSubprocess(
			"rubocop",
			["--format", "json", "--except", "Layout"],
			{ cwd: context.rootDirectory, timeout: 60000 },
		);

		const output = result.stdout;
		if (!output) return [];

		const parsed = JSON.parse(output);
		const diagnostics: Diagnostic[] = [];

		for (const file of parsed.files ?? []) {
			for (const offense of file.offenses ?? []) {
				diagnostics.push({
					filePath: file.path,
					engine: "lint",
					rule: `rubocop/${offense.cop_name}`,
					severity:
						offense.severity === "error" || offense.severity === "fatal"
							? "error"
							: "warning",
					message: offense.message,
					help: "",
					line: offense.location?.start_line ?? 0,
					column: offense.location?.start_column ?? 0,
					category: "Ruby Lint",
					fixable: offense.correctable ?? false,
				});
			}
		}

		return diagnostics;
	} catch {
		return [];
	}
};

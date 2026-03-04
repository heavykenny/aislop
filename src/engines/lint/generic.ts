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
		return parseClippyDiagnostics(result.stdout);
	} catch {
		return [];
	}
};

interface ClippySpan {
	file_name?: string;
	line_start?: number;
	column_start?: number;
}

interface ClippyMessage {
	code?: { code?: string };
	level?: string;
	message?: string;
	children?: Array<{ message?: string }>;
	spans?: ClippySpan[];
}

interface ClippyEntry {
	reason?: string;
	message?: ClippyMessage;
}

const parseClippyEntry = (line: string): ClippyEntry | null => {
	if (!line.startsWith("{")) return null;
	try {
		return JSON.parse(line) as ClippyEntry;
	} catch {
		return null;
	}
};

const toClippyDiagnostic = (entry: ClippyEntry): Diagnostic | null => {
	if (entry.reason !== "compiler-message" || !entry.message) return null;
	const message = entry.message;
	const span = message.spans?.[0];
	return {
		filePath: span?.file_name ?? "",
		engine: "lint",
		rule: `clippy/${message.code?.code ?? "unknown"}`,
		severity: message.level === "error" ? "error" : "warning",
		message: message.message ?? "",
		help: message.children?.[0]?.message ?? "",
		line: span?.line_start ?? 0,
		column: span?.column_start ?? 0,
		category: "Rust Lint",
		fixable: false,
	};
};

const parseClippyDiagnostics = (output: string): Diagnostic[] => {
	const diagnostics: Diagnostic[] = [];
	for (const line of output.split("\n")) {
		const entry = parseClippyEntry(line);
		if (!entry) continue;
		const diagnostic = toClippyDiagnostic(entry);
		if (diagnostic) diagnostics.push(diagnostic);
	}
	return diagnostics;
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

import type { Language } from "../../utils/discover.js";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";

interface FormatterConfig {
	command: string;
	checkArgs: string[];
	fixArgs: string[];
	parseOutput: (output: string, rootDir: string) => Diagnostic[];
}

const FORMATTERS: Partial<Record<Language, FormatterConfig>> = {
	rust: {
		command: "cargo",
		checkArgs: ["fmt", "--check"],
		fixArgs: ["fmt"],
		parseOutput: (output, _rootDir) => {
			const diagnostics: Diagnostic[] = [];
			const lines = output.split("\n").filter((l) => l.startsWith("Diff in"));
			for (const line of lines) {
				const match = line.match(/Diff in (.+) at line (\d+)/);
				if (match) {
					diagnostics.push({
						filePath: match[1],
						engine: "format",
						rule: "rust-formatting",
						severity: "warning",
						message: "Rust file is not formatted correctly",
						help: "Run `npx aislop fix` to auto-format with rustfmt",
						line: parseInt(match[2], 10),
						column: 0,
						category: "Format",
						fixable: true,
					});
				}
			}
			return diagnostics;
		},
	},
	ruby: {
		command: "rubocop",
		checkArgs: ["--format", "json", "--only", "Layout"],
		fixArgs: ["--auto-correct", "--only", "Layout"],
		parseOutput: (output) => {
			try {
				const parsed = JSON.parse(output);
				const diagnostics: Diagnostic[] = [];
				for (const file of parsed.files ?? []) {
					for (const offense of file.offenses ?? []) {
						diagnostics.push({
							filePath: file.path,
							engine: "format",
							rule: offense.cop_name ?? "ruby-formatting",
							severity: "warning",
							message: offense.message ?? "Ruby formatting issue",
							help: "Run `npx aislop fix` to auto-format",
							line: offense.location?.start_line ?? 0,
							column: offense.location?.start_column ?? 0,
							category: "Format",
							fixable: offense.correctable ?? false,
						});
					}
				}
				return diagnostics;
			} catch {
				return [];
			}
		},
	},
	php: {
		command: "php-cs-fixer",
		checkArgs: ["fix", "--dry-run", "--format=json", "."],
		fixArgs: ["fix", "."],
		parseOutput: (output) => {
			try {
				const parsed = JSON.parse(output);
				const diagnostics: Diagnostic[] = [];
				for (const file of parsed.files ?? []) {
					diagnostics.push({
						filePath: file.name,
						engine: "format",
						rule: "php-formatting",
						severity: "warning",
						message: "PHP file is not formatted correctly",
						help: "Run `npx aislop fix` to auto-format",
						line: 0,
						column: 0,
						category: "Format",
						fixable: true,
					});
				}
				return diagnostics;
			} catch {
				return [];
			}
		},
	},
};

export const runGenericFormatter = async (
	context: EngineContext,
	language: Language,
): Promise<Diagnostic[]> => {
	const config = FORMATTERS[language];
	if (!config) return [];

	try {
		const result = await runSubprocess(config.command, config.checkArgs, {
			cwd: context.rootDirectory,
			timeout: 60000,
		});

		const output = result.stdout || result.stderr;
		if (!output) return [];
		return config.parseOutput(output, context.rootDirectory);
	} catch {
		return [];
	}
};

export const fixGenericFormatter = async (
	rootDirectory: string,
	language: Language,
): Promise<void> => {
	const config = FORMATTERS[language];
	if (!config) return;

	const result = await runSubprocess(config.command, config.fixArgs, {
		cwd: rootDirectory,
		timeout: 60000,
	});

	if (result.exitCode !== 0) {
		throw new Error(
			result.stderr || result.stdout || `${config.command} exited with code ${result.exitCode}`,
		);
	}
};

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";
import { createOxlintConfig, type TestFramework } from "./oxlint-config.js";

const esmRequire = createRequire(import.meta.url);

interface OxlintDiagnostic {
	message: string;
	code: string;
	severity: "warning" | "error";
	help: string;
	filename: string;
	labels: Array<{ span: { line: number; column: number } }>;
}

interface OxlintOutput {
	diagnostics: OxlintDiagnostic[];
}

const resolveOxlintBinary = (): string => {
	try {
		const oxlintMainPath = esmRequire.resolve("oxlint");
		const oxlintDir = path.resolve(path.dirname(oxlintMainPath), "..");
		return path.join(oxlintDir, "bin", "oxlint");
	} catch {
		return "oxlint";
	}
};

const parseRuleCode = (code: string): { plugin: string; rule: string } => {
	const match = code.match(/^(.+)\((.+)\)$/);
	if (!match) return { plugin: "unknown", rule: code };
	return { plugin: match[1].replace(/^eslint-plugin-/, ""), rule: match[2] };
};

const detectTestFramework = (rootDir: string): TestFramework => {
	try {
		const raw = fs.readFileSync(path.join(rootDir, "package.json"), "utf-8");
		const pkg = JSON.parse(raw) as Record<string, Record<string, string>>;
		const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

		if (allDeps.vitest) return "vitest";
		if (allDeps.jest || allDeps["ts-jest"] || allDeps["@jest/core"])
			return "jest";
		if (allDeps.mocha) return "mocha";

		// Check for jest in config files
		if (
			fs.existsSync(path.join(rootDir, "jest.config.js")) ||
			fs.existsSync(path.join(rootDir, "jest.config.ts")) ||
			fs.existsSync(path.join(rootDir, "jest.config.mjs"))
		)
			return "jest";
		if (
			fs.existsSync(path.join(rootDir, "vitest.config.ts")) ||
			fs.existsSync(path.join(rootDir, "vitest.config.js"))
		)
			return "vitest";
		if (fs.existsSync(path.join(rootDir, ".mocharc.yml"))) return "mocha";
	} catch {
		// ignore
	}
	return null;
};

export const runOxlint = async (
	context: EngineContext,
): Promise<Diagnostic[]> => {
	const configPath = path.join(
		os.tmpdir(),
		`slop-oxlintrc-${process.pid}.json`,
	);
	const framework = context.frameworks.find((f) => f !== "none");
	const testFramework = detectTestFramework(context.rootDirectory);
	const config = createOxlintConfig({ framework, testFramework });

	try {
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

		const binary = resolveOxlintBinary();
		const args = [binary, "-c", configPath, "--format", "json"];

		const hasTs = context.languages.includes("typescript");
		if (
			hasTs &&
			fs.existsSync(path.join(context.rootDirectory, "tsconfig.json"))
		) {
			args.push("--tsconfig", "./tsconfig.json");
		}

		args.push(".");

		const result = await runSubprocess(process.execPath, args, {
			cwd: context.rootDirectory,
			timeout: 120000,
		});

		if (!result.stdout) return [];

		let output: OxlintOutput;
		try {
			output = JSON.parse(result.stdout) as OxlintOutput;
		} catch {
			return [];
		}

		return output.diagnostics.map((d) => {
			const { plugin, rule } = parseRuleCode(d.code);
			const label = d.labels[0];

			return {
				filePath: d.filename,
				engine: "lint" as const,
				rule: `${plugin}/${rule}`,
				severity: d.severity,
				message:
					d.message.replace(/\S+\.\w+:\d+:\d+[\s\S]*$/, "").trim() || d.message,
				help: d.help || "",
				line: label?.span.line ?? 0,
				column: label?.span.column ?? 0,
				category:
					plugin === "react"
						? "React"
						: plugin === "import"
							? "Imports"
							: "Lint",
				fixable: false,
			};
		});
	} finally {
		if (fs.existsSync(configPath)) {
			fs.unlinkSync(configPath);
		}
	}
};

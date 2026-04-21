import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runSubprocess } from "../../utils/subprocess.js";
import type { Diagnostic, EngineContext } from "../types.js";

const esmRequire = createRequire(import.meta.url);
const ISSUE_PREFIX = "✖ ";

interface ExpoDoctorIssue {
	title: string;
	details: string[];
	advice: string[];
}

const resolveExpoDoctorScript = (): string | null => {
	try {
		const packageJsonPath = esmRequire.resolve("expo-doctor/package.json");
		const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
			bin?: string | Record<string, string>;
		};
		const binRelativePath = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["expo-doctor"];
		if (!binRelativePath) return null;
		return path.join(path.dirname(packageJsonPath), binRelativePath);
	} catch {
		return null;
	}
};

const toRuleSuffix = (title: string): string => {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return slug.length > 0 ? slug : "issue";
};

const parseIssues = (output: string): ExpoDoctorIssue[] => {
	const lines = output.split("\n").map((line) => line.trimEnd());
	const startIndex = lines.findIndex((line) => line.includes("Possible issues detected:"));
	if (startIndex < 0) return [];

	const issues: ExpoDoctorIssue[] = [];
	let current: ExpoDoctorIssue | null = null;
	let inAdvice = false;

	for (let i = startIndex + 1; i < lines.length; i += 1) {
		const raw = lines[i];
		const line = raw.trim();
		if (/^\d+\s+checks failed/.test(line)) break;
		if (line.length === 0) continue;

		if (line.startsWith(ISSUE_PREFIX)) {
			if (current) issues.push(current);
			current = {
				title: line.slice(ISSUE_PREFIX.length).trim(),
				details: [],
				advice: [],
			};
			inAdvice = false;
			continue;
		}

		if (!current) continue;
		if (line === "Advice:") {
			inAdvice = true;
			continue;
		}

		if (inAdvice) {
			current.advice.push(line);
		} else {
			current.details.push(line);
		}
	}

	if (current) issues.push(current);
	return issues;
};

const parseConfigError = (output: string): string | null => {
	const line = output.split("\n").find((candidate) => candidate.trim().startsWith("ConfigError:"));
	return line ? line.trim() : null;
};

const toDiagnostics = (issues: ExpoDoctorIssue[]): Diagnostic[] =>
	issues.map((issue) => {
		const detailText = issue.details.join(" ").trim();
		const adviceText = issue.advice.join(" ").trim();
		const helpParts = [detailText, adviceText].filter((part) => part.length > 0);

		return {
			filePath: "package.json",
			engine: "lint",
			rule: `expo-doctor/${toRuleSuffix(issue.title)}`,
			severity: "warning",
			message: `Expo Doctor: ${issue.title}`,
			help: helpParts.join(" "),
			line: 0,
			column: 0,
			category: "Expo",
			fixable: false,
		};
	});

const hasExpoInstalled = (rootDirectory: string): boolean => {
	try {
		const projectRequire = createRequire(path.join(rootDirectory, "package.json"));
		projectRequire.resolve("expo/package.json");
		return true;
	} catch {
		return false;
	}
};

export const runExpoDoctor = async (context: EngineContext): Promise<Diagnostic[]> => {
	if (!hasExpoInstalled(context.rootDirectory)) return [];

	const scriptPath = resolveExpoDoctorScript();
	let stdout = "";
	let stderr = "";

	try {
		if (scriptPath) {
			const result = await runSubprocess(
				process.execPath,
				[scriptPath, context.rootDirectory, "--verbose"],
				{
					cwd: context.rootDirectory,
					timeout: 120000,
				},
			);
			stdout = result.stdout;
			stderr = result.stderr;
		} else {
			const result = await runSubprocess(
				"npx",
				["--yes", "expo-doctor", context.rootDirectory, "--verbose"],
				{
					cwd: context.rootDirectory,
					timeout: 120000,
				},
			);
			stdout = result.stdout;
			stderr = result.stderr;
		}
	} catch {
		return [];
	}

	const output = [stdout, stderr].filter(Boolean).join("\n");
	if (!output) return [];

	const configError = parseConfigError(output);
	if (configError) {
		return [
			{
				filePath: "package.json",
				engine: "lint",
				rule: "expo-doctor/config-error",
				severity: "warning",
				message: configError,
				help: "Install project dependencies, then re-run `npx aislop scan`.",
				line: 0,
				column: 0,
				category: "Expo",
				fixable: false,
			},
		];
	}

	return toDiagnostics(parseIssues(output));
};

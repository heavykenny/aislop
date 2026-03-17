import fs from "node:fs";
import path from "node:path";
import {
	formatProjectSummary,
	printCommandHeader,
	printProjectMetadata,
} from "../output/layout.js";
import { discoverProject, type Language, type ProjectInfo } from "../utils/discover.js";
import { logger } from "../utils/logger.js";
import { isBundledTool, isNodePackageAvailable } from "../utils/tooling.js";

const LANGUAGE_TOOLS: Record<Language, Array<{ name: string; purpose: string }>> = {
	typescript: [
		{ name: "oxlint", purpose: "Lint (JS/TS)" },
		{ name: "biome", purpose: "Format (JS/TS)" },
	],
	javascript: [
		{ name: "oxlint", purpose: "Lint (JS)" },
		{ name: "biome", purpose: "Format (JS)" },
	],
	python: [
		{ name: "ruff", purpose: "Lint + Format (Python)" },
		{ name: "pip-audit", purpose: "Dependency vulnerability scan (Python)" },
	],
	go: [
		{ name: "golangci-lint", purpose: "Lint (Go)" },
		{ name: "gofmt", purpose: "Format (Go)" },
		{ name: "govulncheck", purpose: "Dependency vulnerability scan (Go)" },
	],
	rust: [{ name: "cargo", purpose: "Lint + Format (Rust)" }],
	java: [],
	ruby: [{ name: "rubocop", purpose: "Lint + Format (Ruby)" }],
	php: [
		{ name: "phpcs", purpose: "Lint (PHP)" },
		{ name: "php-cs-fixer", purpose: "Format (PHP)" },
	],
};

type ReportTool = (
	name: string,
	purpose: string,
	options?: { installed: boolean; bundled?: boolean },
) => void;

const printProjectDetails = (projectInfo: ProjectInfo): void => {
	logger.success(`  ✓ ${formatProjectSummary(projectInfo)}`);
	printProjectMetadata(projectInfo);
	logger.log("  Checks");
	logger.break();
};

const createToolReporter = (): {
	reportTool: ReportTool;
	isAllGood: () => boolean;
} => {
	let allGood = true;
	const seenTools = new Set<string>();

	const reportTool: ReportTool = (name, purpose, options = { installed: false }): void => {
		if (seenTools.has(name)) return;
		seenTools.add(name);

		if (options.installed) {
			const sourceLabel = options.bundled ? " (bundled)" : "";
			logger.success(`  ✓ ${name}${sourceLabel} — ${purpose}`);
			return;
		}

		logger.warn(`  ✗ ${name} — ${purpose} (not installed)`);
		allGood = false;
	};

	return { reportTool, isAllGood: () => allGood };
};

const reportBundledTools = (): void => {
	logger.success("  ✓ oxlint (bundled)");
	logger.success("  ✓ biome (bundled)");
	logger.success("  ✓ knip (bundled)");
};

const reportLanguageTools = (projectInfo: ProjectInfo, reportTool: ReportTool): void => {
	for (const lang of projectInfo.languages) {
		for (const tool of LANGUAGE_TOOLS[lang] ?? []) {
			if (tool.name === "oxlint" || tool.name === "biome") continue;
			reportTool(tool.name, tool.purpose, {
				installed: projectInfo.installedTools[tool.name] === true,
				bundled: isBundledTool(tool.name),
			});
		}
	}
};

const reportJsAuditTool = (
	resolvedDir: string,
	projectInfo: ProjectInfo,
	reportTool: ReportTool,
): void => {
	const hasJsLanguage =
		projectInfo.languages.includes("typescript") || projectInfo.languages.includes("javascript");
	if (!hasJsLanguage) return;

	const hasPnpmLock = fs.existsSync(path.join(resolvedDir, "pnpm-lock.yaml"));
	const hasNpmLock = fs.existsSync(path.join(resolvedDir, "package-lock.json"));
	if (hasPnpmLock) {
		reportTool("pnpm", "Dependency vulnerability scan (JS/TS via pnpm audit)", {
			installed: projectInfo.installedTools["pnpm"] === true,
		});
		return;
	}

	if (hasNpmLock || fs.existsSync(path.join(resolvedDir, "package.json"))) {
		reportTool("npm", "Dependency vulnerability scan (JS/TS via npm audit)", {
			installed: projectInfo.installedTools["npm"] === true,
		});
	}
};

const reportFrameworkTools = (projectInfo: ProjectInfo, reportTool: ReportTool): void => {
	if (!projectInfo.frameworks.includes("expo")) return;
	const hasExpoDoctor = isNodePackageAvailable("expo-doctor");
	reportTool("expo-doctor", "Expo project health checks", {
		installed: hasExpoDoctor,
		bundled: hasExpoDoctor,
	});
};

const printDoctorConclusion = (allGood: boolean): void => {
	logger.break();
	if (allGood) {
		logger.success("  All tools are available. You're good to go!");
	} else {
		logger.warn("  Some tools are missing. Install them for full coverage.");
		logger.dim("  Missing tools will be skipped during scans.");
	}
	logger.break();
};

export const doctorCommand = async (directory: string): Promise<void> => {
	const resolvedDir = path.resolve(directory);

	printCommandHeader("Doctor");

	const projectInfo = await discoverProject(resolvedDir);
	printProjectDetails(projectInfo);

	const { reportTool, isAllGood } = createToolReporter();
	reportBundledTools();
	reportLanguageTools(projectInfo, reportTool);
	reportJsAuditTool(resolvedDir, projectInfo, reportTool);
	reportFrameworkTools(projectInfo, reportTool);
	printDoctorConclusion(isAllGood());
};

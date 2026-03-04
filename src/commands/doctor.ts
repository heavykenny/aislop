import path from "node:path";
import type { Language } from "../utils/discover.js";
import { discoverProject } from "../utils/discover.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";

const LANGUAGE_TOOLS: Record<
	Language,
	Array<{ name: string; purpose: string }>
> = {
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

export const doctorCommand = async (directory: string): Promise<void> => {
	const resolvedDir = path.resolve(directory);

	logger.log(`slop doctor v${process.env.VERSION ?? "0.1.0"}`);
	logger.break();

	const projectInfo = await discoverProject(resolvedDir);

	logger.log(`  Project: ${highlighter.info(projectInfo.projectName)}`);
	logger.log(
		`  Languages: ${highlighter.info(projectInfo.languages.join(", "))}`,
	);
	logger.log(
		`  Source files: ${highlighter.info(String(projectInfo.sourceFileCount))}`,
	);
	logger.break();

	logger.log("  Tool status:");
	logger.break();

	let allGood = true;

	// Bundled tools (always available)
	logger.success("  ✓ oxlint (bundled)");
	logger.success("  ✓ biome (bundled)");
	logger.success("  ✓ knip (bundled)");

	// Check language-specific tools
	for (const lang of projectInfo.languages) {
		const tools = LANGUAGE_TOOLS[lang] ?? [];
		for (const tool of tools) {
			// Skip bundled tools
			if (tool.name === "oxlint" || tool.name === "biome") continue;

			const installed = projectInfo.installedTools[tool.name];
			if (installed) {
				logger.success(`  ✓ ${tool.name} — ${tool.purpose}`);
			} else {
				logger.warn(`  ✗ ${tool.name} — ${tool.purpose} (not installed)`);
				allGood = false;
			}
		}
	}

	logger.break();

	if (allGood) {
		logger.success("  All tools are available. You're good to go!");
	} else {
		logger.warn("  Some tools are missing. Install them for full coverage.");
		logger.dim("  Missing tools will be skipped during scans.");
	}

	logger.break();
};

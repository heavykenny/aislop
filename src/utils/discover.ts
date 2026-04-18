import fs from "node:fs";
import path from "node:path";
import { getSourceFilesForRoot } from "./source-files.js";
import { isToolAvailable } from "./tooling.js";

export type Language =
	| "typescript"
	| "javascript"
	| "python"
	| "go"
	| "rust"
	| "java"
	| "ruby"
	| "php";

export type Framework =
	| "nextjs"
	| "react"
	| "vite"
	| "remix"
	| "expo"
	| "astro"
	| "django"
	| "flask"
	| "fastapi"
	| "none";

export interface ProjectInfo {
	rootDirectory: string;
	projectName: string;
	languages: Language[];
	frameworks: Framework[];
	sourceFileCount: number;
	installedTools: Record<string, boolean>;
}

const LANGUAGE_SIGNALS: Record<string, Language> = {
	"tsconfig.json": "typescript",
	"go.mod": "go",
	"Cargo.toml": "rust",
	Gemfile: "ruby",
	"composer.json": "php",
};

const PYTHON_SIGNALS = [
	"requirements.txt",
	"pyproject.toml",
	"setup.py",
	"setup.cfg",
	"Pipfile",
	"poetry.lock",
];

const JAVA_SIGNALS = ["pom.xml", "build.gradle", "build.gradle.kts"];

const FRAMEWORK_PACKAGES: Record<string, Framework> = {
	next: "nextjs",
	react: "react",
	vite: "vite",
	"@remix-run/react": "remix",
	expo: "expo",
	astro: "astro",
};

const ASTRO_CONFIG_FILENAMES = [
	"astro.config.mjs",
	"astro.config.js",
	"astro.config.ts",
	"astro.config.cjs",
];

const PYTHON_FRAMEWORKS: Record<string, Framework> = {
	django: "django",
	flask: "flask",
	fastapi: "fastapi",
};

const NEXT_CONFIG_FILENAMES = [
	"next.config.js",
	"next.config.mjs",
	"next.config.ts",
	"next.config.cjs",
];

interface PackageJson {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

const readPackageJson = (filePath: string): PackageJson | null => {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PackageJson;
	} catch {
		return null;
	}
};

const countSourceFiles = (rootDirectory: string): number =>
	getSourceFilesForRoot(rootDirectory).length;

const detectLanguages = (directory: string): Language[] => {
	const languages = new Set<Language>();

	// Check file-based signals
	for (const [file, lang] of Object.entries(LANGUAGE_SIGNALS)) {
		if (fs.existsSync(path.join(directory, file))) {
			languages.add(lang);
		}
	}

	// Check package.json for JS/TS
	const packageJson = readPackageJson(path.join(directory, "package.json"));
	if (packageJson) {
		if (fs.existsSync(path.join(directory, "tsconfig.json"))) {
			languages.add("typescript");
		} else {
			languages.add("javascript");
		}
	}

	// Check Python signals
	for (const signal of PYTHON_SIGNALS) {
		if (fs.existsSync(path.join(directory, signal))) {
			languages.add("python");
			break;
		}
	}

	// Check Java signals
	for (const signal of JAVA_SIGNALS) {
		if (fs.existsSync(path.join(directory, signal))) {
			languages.add("java");
			break;
		}
	}

	return [...languages];
};

const detectFrameworks = (directory: string): Framework[] => {
	const frameworks = new Set<Framework>();

	// JS/TS frameworks via package.json
	const packageJson = readPackageJson(path.join(directory, "package.json"));
	if (packageJson) {
		const allDeps = {
			...packageJson.dependencies,
			...packageJson.devDependencies,
		};
		for (const [pkg, fw] of Object.entries(FRAMEWORK_PACKAGES)) {
			if (allDeps[pkg]) frameworks.add(fw);
		}
	}

	// Next.js config files
	for (const configFile of NEXT_CONFIG_FILENAMES) {
		if (fs.existsSync(path.join(directory, configFile))) {
			frameworks.add("nextjs");
			break;
		}
	}

	for (const configFile of ASTRO_CONFIG_FILENAMES) {
		if (fs.existsSync(path.join(directory, configFile))) {
			frameworks.add("astro");
			break;
		}
	}

	// Python frameworks via requirements or pyproject
	const requirementsPath = path.join(directory, "requirements.txt");
	if (fs.existsSync(requirementsPath)) {
		try {
			const content = fs.readFileSync(requirementsPath, "utf-8").toLowerCase();
			for (const [pkg, fw] of Object.entries(PYTHON_FRAMEWORKS)) {
				if (content.includes(pkg)) frameworks.add(fw);
			}
		} catch {
			// ignore
		}
	}

	if (frameworks.size === 0) frameworks.add("none");
	return [...frameworks];
};

const TOOLS_TO_CHECK = [
	"oxlint",
	"biome",
	"ruff",
	"golangci-lint",
	"npm",
	"pnpm",
	"govulncheck",
	"gofmt",
	"pip-audit",
	"cargo",
	"cargo-audit",
	"clippy-driver",
	"rustfmt",
	"rubocop",
	"phpcs",
	"php-cs-fixer",
];

const checkInstalledTools = async (): Promise<Record<string, boolean>> => {
	const results: Record<string, boolean> = {};
	await Promise.all(
		TOOLS_TO_CHECK.map(async (tool) => {
			results[tool] = await isToolAvailable(tool);
		}),
	);
	return results;
};

export const discoverProject = async (directory: string): Promise<ProjectInfo> => {
	const resolvedDir = path.resolve(directory);
	const languages = detectLanguages(resolvedDir);
	const frameworks = detectFrameworks(resolvedDir);
	const sourceFileCount = countSourceFiles(resolvedDir);
	const installedTools = await checkInstalledTools();

	const packageJson = readPackageJson(path.join(resolvedDir, "package.json"));
	const projectName = packageJson?.name ?? path.basename(resolvedDir);

	return {
		rootDirectory: resolvedDir,
		projectName,
		languages,
		frameworks,
		sourceFileCount,
		installedTools,
	};
};

import fs from "node:fs";
import path from "node:path";
import { analyzeCoverage, type Coverage } from "./discovery-coverage.js";
import { getSourceFilesForRoot } from "./source-files.js";
import { isToolAvailable } from "./tooling.js";

export type { Coverage } from "./discovery-coverage.js";

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
	coverage: Coverage;
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

// Source-file extensions map directly to a language. This lets us recognize a
// project from its actual source files even when no manifest/build file is
// present (e.g. a bare directory of .py files with no pyproject.toml). Without
// this, manifest-only languages (python, go, rust, ruby, java, php) stay
// undetected and every engine gated on languages.includes(...) silently skips.
const EXTENSION_LANGUAGES: Record<string, Language> = {
	".ts": "typescript",
	".tsx": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
	".pyi": "python",
	".go": "go",
	".rs": "rust",
	".rb": "ruby",
	".java": "java",
	".php": "php",
};

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

const readTextFile = (filePath: string): string | null => {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
};

const readPackageJson = (filePath: string): PackageJson | null => {
	const content = readTextFile(filePath);
	if (content === null) return null;
	try {
		return JSON.parse(content) as PackageJson;
	} catch {
		return null;
	}
};

export const detectSourceLanguages = (sourceFiles: string[]): Language[] => {
	const languages = new Set<Language>();

	for (const sourceFile of sourceFiles) {
		const lang = EXTENSION_LANGUAGES[path.extname(sourceFile).toLowerCase()];
		if (lang) languages.add(lang);
	}

	return [...languages];
};

const detectLanguages = (directory: string, sourceFiles: string[]): Language[] => {
	const languages = new Set<Language>(detectSourceLanguages(sourceFiles));

	for (const [file, lang] of Object.entries(LANGUAGE_SIGNALS)) {
		if (fs.existsSync(path.join(directory, file))) {
			languages.add(lang);
		}
	}

	const packageJson = readPackageJson(path.join(directory, "package.json"));
	if (packageJson) {
		if (fs.existsSync(path.join(directory, "tsconfig.json"))) {
			languages.add("typescript");
		} else {
			languages.add("javascript");
		}
	}

	for (const signal of PYTHON_SIGNALS) {
		if (fs.existsSync(path.join(directory, signal))) {
			languages.add("python");
			break;
		}
	}

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
	const requirements = readTextFile(requirementsPath)?.toLowerCase();
	if (requirements) {
		for (const [pkg, fw] of Object.entries(PYTHON_FRAMEWORKS)) {
			if (requirements.includes(pkg)) frameworks.add(fw);
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

interface DiscoveryInputs {
	readonly includePatterns?: string[];
	readonly installedTools?: Record<string, boolean>;
	readonly projectFiles?: string[];
	readonly sourceFiles?: string[];
}

export const discoverProject = async (
	directory: string,
	excludePatterns: string[] = [],
	inputs: DiscoveryInputs = {},
): Promise<ProjectInfo> => {
	const resolvedDir = path.resolve(directory);
	const sourceFiles = inputs.sourceFiles ?? getSourceFilesForRoot(resolvedDir);
	const coverage = analyzeCoverage(resolvedDir, {
		excludePatterns,
		includePatterns: inputs.includePatterns ?? [],
		...(inputs.projectFiles ? { projectFiles: inputs.projectFiles } : {}),
	});
	const installedTools = inputs.installedTools ?? (await checkInstalledTools());
	const packageJson = readPackageJson(path.join(resolvedDir, "package.json"));
	return {
		rootDirectory: resolvedDir,
		projectName: packageJson?.name ?? path.basename(resolvedDir),
		languages: detectLanguages(resolvedDir, sourceFiles),
		frameworks: detectFrameworks(resolvedDir),
		sourceFileCount: sourceFiles.length,
		coverage,
		installedTools,
	};
};

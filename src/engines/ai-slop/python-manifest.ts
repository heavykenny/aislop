import fs from "node:fs";
import path from "node:path";

const addPyDep = (pyDeps: Set<string>, name: string): void => {
	const match = name.trim().match(/^([a-zA-Z0-9_.-]+)/);
	if (!match) return;
	const normalized = match[1].toLowerCase().replace(/_/g, "-");
	pyDeps.add(normalized);
};

const collectFromRequirementsTxt = (rootDir: string, pyDeps: Set<string>): boolean => {
	const reqPath = path.join(rootDir, "requirements.txt");
	if (!fs.existsSync(reqPath)) return false;
	try {
		const content = fs.readFileSync(reqPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
			const match = trimmed.match(/^([a-zA-Z0-9_\-.]+)/);
			if (match) addPyDep(pyDeps, match[1]);
		}
		return true;
	} catch {
		return false;
	}
};

const TOML_HEADER_RE = /^\s*\[([^\]]+)\]\s*$/;

const readTomlSection = (content: string, sectionName: string): string => {
	const lines = content.split(/\r?\n/);
	const sectionLines: string[] = [];
	let inSection = false;

	for (const line of lines) {
		const header = line.match(TOML_HEADER_RE);
		if (header) {
			if (inSection) break;
			inSection = header[1] === sectionName;
			continue;
		}
		if (inSection) sectionLines.push(line);
	}

	return sectionLines.join("\n");
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractTomlArrayBody = (section: string, key: string): string | null => {
	const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*\\[`, "m").exec(section);
	if (!match) return null;

	const openingIndex = match.index + match[0].lastIndexOf("[");
	const start = openingIndex + 1;
	let depth = 1;
	let quote: string | null = null;
	let escaped = false;

	for (let i = start; i < section.length; i += 1) {
		const char = section[i];
		if (quote) {
			if (quote === '"' && !escaped && char === "\\") {
				escaped = true;
				continue;
			}
			if (!escaped && char === quote) quote = null;
			escaped = false;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === "[") {
			depth += 1;
		} else if (char === "]") {
			depth -= 1;
			if (depth === 0) return section.slice(start, i);
		}
	}

	return null;
};

const extractTomlStrings = (source: string): string[] => {
	const values: string[] = [];
	let quote: string | null = null;
	let escaped = false;
	let current = "";

	for (const char of source) {
		if (!quote) {
			if (char === '"' || char === "'") {
				quote = char;
				current = "";
				escaped = false;
			}
			continue;
		}

		if (quote === '"' && !escaped && char === "\\") {
			escaped = true;
			continue;
		}
		if (!escaped && char === quote) {
			values.push(current);
			quote = null;
			current = "";
			continue;
		}
		current += char;
		escaped = false;
	}

	return values;
};

const addTomlArrayDeps = (section: string, key: string, pyDeps: Set<string>): void => {
	const body = extractTomlArrayBody(section, key);
	if (!body) return;
	for (const value of extractTomlStrings(body)) {
		addPyDep(pyDeps, value);
	}
};

const collectFromPyproject = (rootDir: string, pyDeps: Set<string>): boolean => {
	const pyprojPath = path.join(rootDir, "pyproject.toml");
	if (!fs.existsSync(pyprojPath)) return false;
	try {
		const content = fs.readFileSync(pyprojPath, "utf-8");
		const projectSection = readTomlSection(content, "project");
		const projectNameMatch = projectSection.match(/^\s*name\s*=\s*["']([^"']+)/m);
		if (projectNameMatch) addPyDep(pyDeps, projectNameMatch[1]);

		const poetrySection = readTomlSection(content, "tool.poetry");
		const poetryNameMatch = poetrySection.match(/^\s*name\s*=\s*["']([^"']+)/m);
		if (poetryNameMatch) addPyDep(pyDeps, poetryNameMatch[1]);

		addTomlArrayDeps(projectSection, "dependencies", pyDeps);

		// PEP 621 extras: [project.optional-dependencies] holds arrays of requirements.
		const extras = readTomlSection(content, "project.optional-dependencies");
		if (extras) {
			for (const value of extractTomlStrings(extras)) addPyDep(pyDeps, value);
		}
		// PEP 735 dependency groups: [dependency-groups] holds named arrays of requirements.
		const groups = readTomlSection(content, "dependency-groups");
		if (groups) {
			for (const value of extractTomlStrings(groups)) addPyDep(pyDeps, value);
		}
		const poetryRe =
			/\[tool\.poetry(?:\.group\.[a-z0-9_-]+)?\.dependencies\]([\s\S]*?)(?=\n\[|$)/gi;
		let match: RegExpExecArray | null = poetryRe.exec(content);
		while (match !== null) {
			for (const line of match[1].split("\n")) {
				const m = line.trim().match(/^([a-zA-Z0-9_\-.]+)\s*=/);
				if (m && m[1] !== "python") addPyDep(pyDeps, m[1]);
			}
			match = poetryRe.exec(content);
		}
		return true;
	} catch {
		return false;
	}
};

const collectFromPipfile = (rootDir: string, pyDeps: Set<string>): boolean => {
	const pipfilePath = path.join(rootDir, "Pipfile");
	if (!fs.existsSync(pipfilePath)) return false;
	try {
		const content = fs.readFileSync(pipfilePath, "utf-8");
		const sectionRe = /\[(packages|dev-packages)\]([\s\S]*?)(?=\n\[|$)/g;
		let match: RegExpExecArray | null = sectionRe.exec(content);
		while (match !== null) {
			for (const line of match[2].split("\n")) {
				const m = line.trim().match(/^([a-zA-Z0-9_\-.]+)\s*=/);
				if (m) addPyDep(pyDeps, m[1]);
			}
			match = sectionRe.exec(content);
		}
		return true;
	} catch {
		return false;
	}
};

export interface PythonDependencyScope {
	directory: string;
	pyDeps: Set<string>;
	hasPyManifest: boolean;
}

const LOCAL_PACKAGE_ROOTS = ["", "src", "lib"];

const collectLocalPythonPackages = (rootDir: string, pyDeps: Set<string>): void => {
	for (const sub of LOCAL_PACKAGE_ROOTS) {
		const dir = sub ? path.join(rootDir, sub) : rootDir;
		let entries: import("node:fs").Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".")) continue;
			if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
			const initPath = path.join(dir, entry.name, "__init__.py");
			if (fs.existsSync(initPath)) addPyDep(pyDeps, entry.name);
		}
	}
};

const collectScope = (rootDir: string): PythonDependencyScope => {
	const pyDeps = new Set<string>();
	const hasReq = collectFromRequirementsTxt(rootDir, pyDeps);
	const hasPyproject = collectFromPyproject(rootDir, pyDeps);
	const hasPipfile = collectFromPipfile(rootDir, pyDeps);
	collectLocalPythonPackages(rootDir, pyDeps);
	return {
		directory: rootDir,
		pyDeps,
		hasPyManifest: hasReq || hasPyproject || hasPipfile,
	};
};

const SKIP_MANIFEST_DIRS = new Set([
	".git",
	".mypy_cache",
	".pytest_cache",
	".ruff_cache",
	".tox",
	".venv",
	"__pycache__",
	"build",
	"dist",
	"node_modules",
	"site-packages",
]);
const NESTED_PY_MANIFEST_DEPTH = 4;

const collectNestedScopes = (rootDir: string): PythonDependencyScope[] => {
	const scopes: PythonDependencyScope[] = [];

	const walk = (dir: string, depth: number): void => {
		if (depth > NESTED_PY_MANIFEST_DEPTH) return;
		let entries: import("node:fs").Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		const hasManifest = entries.some(
			(entry) =>
				entry.isFile() &&
				(entry.name === "pyproject.toml" ||
					entry.name === "requirements.txt" ||
					entry.name === "Pipfile"),
		);
		if (dir !== rootDir && hasManifest) {
			const scope = collectScope(dir);
			if (scope.hasPyManifest) scopes.push(scope);
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (entry.name.startsWith(".") || SKIP_MANIFEST_DIRS.has(entry.name)) continue;
			walk(path.join(dir, entry.name), depth + 1);
		}
	};

	walk(rootDir, 0);
	return scopes;
};

export const collectPythonDeps = (
	rootDir: string,
): {
	pyDeps: Set<string>;
	hasPyManifest: boolean;
	rootHasPyManifest: boolean;
	scopes: PythonDependencyScope[];
} => {
	const rootScope = collectScope(rootDir);
	const nestedScopes = collectNestedScopes(rootDir);
	const scopes = [rootScope, ...nestedScopes];
	const pyDeps = new Set<string>();
	for (const scope of scopes) {
		for (const dep of scope.pyDeps) pyDeps.add(dep);
	}
	return {
		pyDeps,
		hasPyManifest: scopes.some((scope) => scope.hasPyManifest),
		rootHasPyManifest: rootScope.hasPyManifest,
		scopes,
	};
};

import fs from "node:fs";
import path from "node:path";

const addPyDep = (pyDeps: Set<string>, name: string): void => {
	const normalized = name.toLowerCase().replace(/_/g, "-");
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

const collectFromPyproject = (rootDir: string, pyDeps: Set<string>): boolean => {
	const pyprojPath = path.join(rootDir, "pyproject.toml");
	if (!fs.existsSync(pyprojPath)) return false;
	try {
		const content = fs.readFileSync(pyprojPath, "utf-8");
		const projectNameMatch = content.match(/\[project\][\s\S]*?^\s*name\s*=\s*["']([^"']+)/m);
		if (projectNameMatch) addPyDep(pyDeps, projectNameMatch[1]);
		const poetryNameMatch = content.match(/\[tool\.poetry\][\s\S]*?^\s*name\s*=\s*["']([^"']+)/m);
		if (poetryNameMatch) addPyDep(pyDeps, poetryNameMatch[1]);
		const pep621 = content.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m);
		if (pep621) {
			for (const line of pep621[1].split("\n")) {
				const m = line.match(/["']\s*([a-zA-Z0-9_\-.]+)/);
				if (m) addPyDep(pyDeps, m[1]);
			}
		}
		// PEP 621 extras: [project.optional-dependencies] holds arrays of requirements.
		const extras = content.match(/\[project\.optional-dependencies\]([\s\S]*?)(?=\n\[|$)/);
		if (extras) {
			for (const m of extras[1].matchAll(/["']\s*([a-zA-Z][a-zA-Z0-9_\-.]+)/g)) {
				addPyDep(pyDeps, m[1]);
			}
		}
		// PEP 735 dependency groups: [dependency-groups] holds named arrays of requirements.
		const groups = content.match(/\[dependency-groups\]([\s\S]*?)(?=\n\[[^[]|$)/);
		if (groups) {
			for (const m of groups[1].matchAll(/["']\s*([a-zA-Z][a-zA-Z0-9_\-.]+)/g)) {
				addPyDep(pyDeps, m[1]);
			}
		}
		const poetryRe = /\[tool\.poetry(?:\.group\.[a-z]+)?\.dependencies\]([\s\S]*?)(?=\n\[|$)/g;
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

export const collectPythonDeps = (
	rootDir: string,
): { pyDeps: Set<string>; hasPyManifest: boolean } => {
	const pyDeps = new Set<string>();
	const hasReq = collectFromRequirementsTxt(rootDir, pyDeps);
	const hasPyproject = collectFromPyproject(rootDir, pyDeps);
	const hasPipfile = collectFromPipfile(rootDir, pyDeps);
	collectLocalPythonPackages(rootDir, pyDeps);
	return { pyDeps, hasPyManifest: hasReq || hasPyproject || hasPipfile };
};

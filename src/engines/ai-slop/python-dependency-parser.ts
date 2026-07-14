import fs from "node:fs";
import path from "node:path";

const MAX_PYTHON_MANIFEST_BYTES = 1_048_576;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

export const PYTHON_MANIFEST_FILES = ["pyproject.toml", "requirements.txt", "Pipfile"] as const;

const isWithinDirectory = (directory: string, filePath: string): boolean => {
	const relative = path.relative(directory, filePath);
	return (
		relative === "" ||
		(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
	);
};

const readPythonManifest = (filePath: string, boundaryDir: string): string | null => {
	let descriptor: number | null = null;
	try {
		const realBoundary = fs.realpathSync(boundaryDir);
		const realFile = fs.realpathSync(filePath);
		if (!isWithinDirectory(realBoundary, realFile)) return null;
		descriptor = fs.openSync(realFile, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
		const stat = fs.fstatSync(descriptor);
		if (!stat.isFile() || stat.size > MAX_PYTHON_MANIFEST_BYTES) return null;
		const content = Buffer.alloc(stat.size);
		let offset = 0;
		while (offset < content.length) {
			const bytesRead = fs.readSync(descriptor, content, offset, content.length - offset, null);
			if (bytesRead === 0) break;
			offset += bytesRead;
		}
		const overflow = Buffer.alloc(1);
		if (fs.readSync(descriptor, overflow, 0, 1, null) > 0) return null;
		return UTF8_DECODER.decode(content.subarray(0, offset));
	} catch {
		return null;
	} finally {
		if (descriptor !== null) fs.closeSync(descriptor);
	}
};

export const readPyproject = (rootDir: string): string | null =>
	readPythonManifest(path.join(rootDir, "pyproject.toml"), rootDir);

export const addPyDep = (pyDeps: Set<string>, name: string): void => {
	const match = name.trim().match(/^([a-zA-Z0-9_.-]+)/);
	if (!match) return;
	const normalized = match[1].toLowerCase().replace(/_/g, "-");
	pyDeps.add(normalized);
};

export const collectFromRequirementsTxt = (rootDir: string, pyDeps: Set<string>): boolean => {
	const reqPath = path.join(rootDir, "requirements.txt");
	try {
		const content = readPythonManifest(reqPath, rootDir);
		if (content === null) return false;
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

		// A `#` outside a string begins a comment to end-of-line. Skipping it keeps
		// quote/bracket tracking correct when a comment holds an apostrophe or a
		// bracket (e.g. `"pr-crew",  # the dashboard's (lazy) use`).
		if (char === "#") {
			const newline = section.indexOf("\n", i);
			if (newline === -1) return null;
			i = newline;
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

	for (let i = 0; i < source.length; i += 1) {
		const char = source[i];
		if (!quote) {
			// Skip `#` comments so quoted prose inside them isn't read as a value.
			if (char === "#") {
				const newline = source.indexOf("\n", i);
				if (newline === -1) break;
				i = newline;
				continue;
			}
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

export const collectFromPyproject = (rootDir: string, pyDeps: Set<string>): boolean => {
	try {
		const content = readPyproject(rootDir);
		if (content === null) return false;
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

export const collectFromPipfile = (rootDir: string, pyDeps: Set<string>): boolean => {
	const pipfilePath = path.join(rootDir, "Pipfile");
	try {
		const content = readPythonManifest(pipfilePath, rootDir);
		if (content === null) return false;
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

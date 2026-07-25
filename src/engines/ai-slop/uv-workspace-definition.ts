import fs from "node:fs";
import path from "node:path";
import { parse, type TomlTable, type TomlValue } from "smol-toml";
import { readPyproject } from "./python-dependency-parser.js";

const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const PROJECT_VERSION_PATTERN =
	/^\s*v?(?:([0-9]+)!)?([0-9]+(?:\.[0-9]+)*)(?:[-_.]?(?:alpha|a|beta|b|preview|pre|c|rc)[-_.]?([0-9]*))?(?:(?:-([0-9]+))|(?:[-_.]?(?:post|rev|r)[-_.]?([0-9]*)))?(?:[-_.]?dev[-_.]?([0-9]*))?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?\s*$/i;
const VERSION_WILDCARD_PATTERN = /^\s*v?(?:([0-9]+)!)?([0-9]+(?:\.[0-9]+)*)\.\*\s*$/i;
const MAX_U64 = "18446744073709551615";

const isTomlTable = (value: TomlValue | undefined): value is TomlTable =>
	typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);

const parsePyproject = (content: string): TomlTable | null => {
	try {
		return parse(content);
	} catch {
		return null;
	}
};

const readStringArray = (value: TomlValue | undefined): string[] | null => {
	if (value === undefined) return [];
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return null;
	return value;
};

const isValidU64 = (value: string): boolean => {
	const normalized = value.replace(/^0+/, "") || "0";
	return (
		normalized.length < MAX_U64.length ||
		(normalized.length === MAX_U64.length && normalized <= MAX_U64)
	);
};

interface ParsedProjectVersion {
	hasLocal: boolean;
	releaseSegments: number;
}

const parseProjectVersion = (value: string): ParsedProjectVersion | null => {
	const match = PROJECT_VERSION_PATTERN.exec(value);
	if (!match) return null;
	const localParts = match[7]?.split(/[-_.]/) ?? [];
	const numericParts = [
		...(match[1] ? [match[1]] : []),
		...match[2].split("."),
		...match.slice(3, 7).filter((part): part is string => Boolean(part)),
		...localParts.filter((part) => /^[0-9]+$/.test(part)),
	];
	if (!numericParts.every(isValidU64)) return null;
	return { hasLocal: localParts.length > 0, releaseSegments: match[2].split(".").length };
};

const isValidVersionSpecifier = (value: string): boolean => {
	const match = value.match(/^\s*(===|~=|==|!=|<=|>=|<|>)\s*(\S+)\s*$/);
	if (!match) return false;
	const operator = match[1];
	const version = match[2];
	if (version.endsWith(".*")) {
		if (operator !== "==" && operator !== "!=") return false;
		const wildcard = VERSION_WILDCARD_PATTERN.exec(version);
		if (!wildcard) return false;
		return [...(wildcard[1] ? [wildcard[1]] : []), ...wildcard[2].split(".")].every(isValidU64);
	}
	const parsed = parseProjectVersion(version);
	if (!parsed) return false;
	if (["~=", "<", "<=", ">", ">="].includes(operator) && parsed.hasLocal) return false;
	return operator !== "~=" || parsed.releaseSegments >= 2;
};

const isValidVersionSpecifiers = (value: string): boolean =>
	value === "" || value.split(",").every(isValidVersionSpecifier);

const isValidOptionalDependencies = (value: TomlValue | undefined): boolean => {
	if (value === undefined) return true;
	if (!isTomlTable(value)) return false;
	const names = new Set<string>();
	for (const [name, dependencies] of Object.entries(value)) {
		if (!PROJECT_NAME_PATTERN.test(name) || readStringArray(dependencies) === null) return false;
		const normalized = name.toLowerCase().replace(/[-_.]+/g, "-");
		if (names.has(normalized)) return false;
		names.add(normalized);
	}
	return true;
};

const hasValidProjectMetadata = (project: TomlTable): boolean => {
	const dynamic = readStringArray(project.dynamic);
	if (!dynamic) return false;
	if (project.version === undefined && !dynamic.includes("version")) return false;
	if (project.version !== undefined) {
		if (typeof project.version !== "string" || !parseProjectVersion(project.version)) return false;
	}
	const requiresPython = project["requires-python"];
	if (requiresPython !== undefined) {
		if (typeof requiresPython !== "string" || !isValidVersionSpecifiers(requiresPython)) {
			return false;
		}
	}
	return (
		readStringArray(project.dependencies) !== null &&
		isValidOptionalDependencies(project["optional-dependencies"])
	);
};

const readProjectName = (project: TomlTable): string | null => {
	if (typeof project.name !== "string" || !PROJECT_NAME_PATTERN.test(project.name)) return null;
	return hasValidProjectMetadata(project) ? project.name : null;
};

type UvWorkspaceDefinition =
	| { kind: "none" | "unmanaged" | "invalid" }
	| {
			kind: "workspace";
			members: string[];
			exclude: string[];
			rootProjectName: string | null;
	  };

export const readUvWorkspaceDefinition = (rootDir: string): UvWorkspaceDefinition => {
	const content = readPyproject(rootDir);
	if (content === null) return { kind: "invalid" };
	const document = parsePyproject(content);
	if (!document) return { kind: "invalid" };

	const projectValue = document.project;
	if (projectValue !== undefined && !isTomlTable(projectValue)) return { kind: "invalid" };
	const rootProjectName = isTomlTable(projectValue) ? readProjectName(projectValue) : null;
	if (isTomlTable(projectValue) && rootProjectName === null) return { kind: "invalid" };

	const toolValue = document.tool;
	if (toolValue === undefined) return { kind: "none" };
	if (!isTomlTable(toolValue)) return { kind: "invalid" };
	const uvValue = toolValue.uv;
	if (uvValue === undefined) return { kind: "none" };
	if (!isTomlTable(uvValue)) return { kind: "invalid" };
	if (uvValue.managed !== undefined && typeof uvValue.managed !== "boolean") {
		return { kind: "invalid" };
	}
	if (uvValue.managed === false) return { kind: "unmanaged" };
	const workspaceValue = uvValue.workspace;
	if (workspaceValue === undefined) return { kind: "none" };
	if (!isTomlTable(workspaceValue)) return { kind: "invalid" };
	const members = readStringArray(workspaceValue.members);
	const exclude = readStringArray(workspaceValue.exclude);
	if (!members || !exclude) return { kind: "invalid" };
	return { kind: "workspace", members, exclude, rootProjectName };
};

type UvWorkspaceMemberAdmission =
	| { kind: "member"; name: string }
	| { kind: "unmanaged" | "missing" | "invalid" };

export const classifyUvWorkspaceMember = (directory: string): UvWorkspaceMemberAdmission => {
	const pyprojectPath = path.join(directory, "pyproject.toml");
	if (!fs.existsSync(pyprojectPath)) return { kind: "missing" };
	const content = readPyproject(directory);
	if (content === null) return { kind: "invalid" };
	const document = parsePyproject(content);
	if (!document) return { kind: "invalid" };
	const toolValue = document.tool;
	if (toolValue !== undefined && !isTomlTable(toolValue)) return { kind: "invalid" };
	const uvValue = isTomlTable(toolValue) ? toolValue.uv : undefined;
	if (uvValue !== undefined && !isTomlTable(uvValue)) return { kind: "invalid" };
	if (isTomlTable(uvValue)) {
		if (uvValue.managed !== undefined && typeof uvValue.managed !== "boolean") {
			return { kind: "invalid" };
		}
		if (uvValue.managed === false) return { kind: "unmanaged" };
		if (uvValue.workspace !== undefined) return { kind: "invalid" };
	}
	const projectValue = document.project;
	if (!isTomlTable(projectValue)) return { kind: "invalid" };
	const name = readProjectName(projectValue);
	return name === null ? { kind: "invalid" } : { kind: "member", name };
};

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isToolInstalled } from "./subprocess.js";

const THIS_FILE = fileURLToPath(import.meta.url);
const _esmRequire = createRequire(import.meta.url);

const resolvePackageRoot = (startFile: string): string => {
	let current = path.dirname(startFile);
	while (true) {
		const packageJsonPath = path.join(current, "package.json");
		if (fs.existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as {
					name?: string;
				};
				if (packageJson.name === "aislop") {
					return current;
				}
			} catch {
				// Ignore unreadable package.json files and keep walking up.
			}
		}

		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return path.resolve(path.dirname(startFile), "..", "..");
};

const PACKAGE_ROOT = resolvePackageRoot(THIS_FILE);
const TOOLS_BIN_DIR = path.join(PACKAGE_ROOT, "tools", "bin");

const BUNDLED_TOOL_NAMES = new Set(["ruff", "golangci-lint"]);

const withExecutableExtension = (toolName: string): string =>
	process.platform === "win32" ? `${toolName}.exe` : toolName;

const getBundledToolPath = (toolName: string): string | null => {
	if (!BUNDLED_TOOL_NAMES.has(toolName)) return null;
	const candidate = path.join(TOOLS_BIN_DIR, withExecutableExtension(toolName));
	return fs.existsSync(candidate) ? candidate : null;
};

// A real executable, not just any entry that exists: a directory or a stale
// non-executable file named like the tool would pass existsSync but fail at spawn,
// silently shadowing the bundled tool. On Windows the .exe extension (the only name
// we look for) implies executability and ACL checks are not reliably observable via
// fs; on POSIX we require an execute bit.
const isExecutableFile = (candidate: string): boolean => {
	let stats: fs.Stats;
	try {
		stats = fs.statSync(candidate);
	} catch {
		return false;
	}
	if (!stats.isFile()) return false;
	if (process.platform === "win32") return true;
	return (stats.mode & 0o111) !== 0;
};

// Synchronous PATH lookup for a bundled tool's system install. We check for the
// platform executable name in each PATH entry rather than shelling out to
// `which` so resolveToolBinary can stay synchronous. (.exe on Windows covers the
// pip/standalone ruff and golangci-lint distributions, the only bundled tools.)
const findToolOnPath = (toolName: string): string | null => {
	const executable = withExecutableExtension(toolName);
	const pathValue = process.env.PATH ?? "";
	for (const directory of pathValue.split(path.delimiter)) {
		if (!directory) continue;
		const candidate = path.join(directory, executable);
		if (isExecutableFile(candidate)) return candidate;
	}
	return null;
};

export const resolveToolBinary = (toolName: string): string => {
	// Non-bundled tools (roslynator, jb) have no vendored-vs-system conflict:
	// return the bare name so the OS PATH+PATHEXT lookup resolves them at spawn.
	if (!BUNDLED_TOOL_NAMES.has(toolName)) return toolName;
	// Bundled tools (ruff, golangci-lint): prefer a system install so aislop runs
	// the SAME version the project pins and CI gates on, instead of our vendored
	// copy that drifts across the tool's style/release editions. Fall back to the
	// bundled binary (then bare name) when the tool is not on PATH, preserving the
	// zero-dependency guarantee for users who never installed it.
	return findToolOnPath(toolName) ?? getBundledToolPath(toolName) ?? toolName;
};

const isBundledTool = (toolName: string): boolean => getBundledToolPath(toolName) !== null;

export const isToolAvailable = async (toolName: string): Promise<boolean> => {
	if (isBundledTool(toolName)) return true;
	return isToolInstalled(toolName);
};

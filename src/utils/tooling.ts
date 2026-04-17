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

export const resolveToolBinary = (toolName: string): string =>
	getBundledToolPath(toolName) ?? toolName;

const isBundledTool = (toolName: string): boolean => getBundledToolPath(toolName) !== null;

export const isToolAvailable = async (toolName: string): Promise<boolean> => {
	if (isBundledTool(toolName)) return true;
	return isToolInstalled(toolName);
};

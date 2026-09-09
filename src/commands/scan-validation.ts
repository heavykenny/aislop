import fs from "node:fs";
import { baseRefExists } from "../utils/git.js";
import type { ScanOptions } from "./scan-options.js";

export const scanTargetError = (resolvedDir: string, options: ScanOptions): string | null => {
	if (!fs.existsSync(resolvedDir)) return `Path does not exist: ${resolvedDir}`;
	if (!fs.statSync(resolvedDir).isDirectory()) return `Not a directory: ${resolvedDir}`;
	if (options.changes && options.base && !baseRefExists(resolvedDir, options.base)) {
		return `Could not resolve base ref "${options.base}". Make sure it exists and was fetched (e.g. \`git fetch origin ${options.base}\`).`;
	}
	return null;
};

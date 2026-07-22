import fs from "node:fs";
import path from "node:path";
import { safeProjectFilePath } from "./project-path-safety.js";

export const readAislopIgnorePatterns = (rootDirectory: string): string[] => {
	const ignorePath = safeProjectFilePath(path.join(rootDirectory, ".aislopignore"), rootDirectory);
	if (!ignorePath) return [];
	try {
		return fs
			.readFileSync(ignorePath, "utf-8")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#"));
	} catch {
		return [];
	}
};

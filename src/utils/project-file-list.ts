import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_BUFFER = 50 * 1024 * 1024;

export const enumerateProjectFilesFromDisk = (
	rootDirectory: string,
	pruneDirectories: Set<string>,
): string[] => {
	const files: string[] = [];
	const walk = (directory: string): void => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				if (!pruneDirectories.has(entry.name)) walk(fullPath);
			} else if (entry.isFile()) {
				files.push(path.relative(rootDirectory, fullPath).split(path.sep).join("/"));
			}
		}
	};
	walk(rootDirectory);
	return files;
};

export const enumerateProjectFiles = (
	rootDirectory: string,
	pruneDirectories: Set<string>,
): string[] => {
	const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
		cwd: rootDirectory,
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
	});

	if (!result.error && result.status === 0) {
		return result.stdout
			.split("\n")
			.filter((file) => file.length > 0)
			.filter((file) => fs.existsSync(path.resolve(rootDirectory, file)));
	}

	return enumerateProjectFilesFromDisk(rootDirectory, pruneDirectories);
};

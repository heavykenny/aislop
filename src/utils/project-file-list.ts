import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_BUFFER = 50 * 1024 * 1024;

const normalizePruneDirectories = (directories: Set<string>): Set<string> =>
	new Set([...directories].map((directory) => directory.toLowerCase()));

const isInPrunedDirectory = (filePath: string, pruneDirectories: Set<string>): boolean => {
	const pathSegments = filePath.split("/");
	pathSegments.pop();
	return pathSegments.some((segment) => pruneDirectories.has(segment.toLowerCase()));
};

export const enumerateProjectFilesFromDisk = (
	rootDirectory: string,
	pruneDirectories: Set<string>,
): string[] => {
	const files: string[] = [];
	const normalizedPruneDirectories = normalizePruneDirectories(pruneDirectories);
	const walk = (directory: string): void => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(directory, entry.name);
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) {
				let stats: fs.Stats;
				try {
					stats = fs.lstatSync(fullPath);
				} catch {
					continue;
				}
				if (
					stats.isDirectory() &&
					!stats.isSymbolicLink() &&
					!normalizedPruneDirectories.has(entry.name.toLowerCase())
				) {
					walk(fullPath);
				}
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
		const normalizedPruneDirectories = normalizePruneDirectories(pruneDirectories);
		return result.stdout
			.split("\n")
			.filter((file) => file.length > 0)
			.filter((file) => !isInPrunedDirectory(file, normalizedPruneDirectories))
			.filter((file) => fs.existsSync(path.resolve(rootDirectory, file)));
	}

	return enumerateProjectFilesFromDisk(rootDirectory, pruneDirectories);
};

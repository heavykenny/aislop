import fs from "node:fs";
import path from "node:path";

const MAX_PROJECT_CONFIG_BYTES = 1024 * 1024;

const isWithinDirectory = (rootDirectory: string, candidate: string): boolean => {
	const relative = path.relative(rootDirectory, candidate);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

export const safeProjectFilePath = (
	candidate: string,
	rootDirectory: string,
	maxBytes = MAX_PROJECT_CONFIG_BYTES,
): string | null => {
	try {
		const absoluteRoot = path.resolve(rootDirectory);
		const realRoot = fs.realpathSync(rootDirectory);
		const absolutePath = path.resolve(candidate);
		if (!isWithinDirectory(absoluteRoot, absolutePath)) return null;
		const stats = fs.lstatSync(absolutePath);
		if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maxBytes) return null;
		const realPath = fs.realpathSync(absolutePath);
		return isWithinDirectory(realRoot, realPath) ? realPath : null;
	} catch {
		return null;
	}
};

export const safeProjectDirectoryPath = (
	candidate: string,
	rootDirectory: string,
): string | null => {
	try {
		const absoluteRoot = path.resolve(rootDirectory);
		const realRoot = fs.realpathSync(rootDirectory);
		const absolutePath = path.resolve(candidate);
		if (!isWithinDirectory(absoluteRoot, absolutePath)) return null;
		const stats = fs.lstatSync(absolutePath);
		if (!stats.isDirectory() || stats.isSymbolicLink()) return null;
		const realPath = fs.realpathSync(absolutePath);
		return isWithinDirectory(realRoot, realPath) ? realPath : null;
	} catch {
		return null;
	}
};

export const isRootBoundedTarget = (candidate: string, rootDirectory: string): boolean => {
	try {
		const absoluteRoot = path.resolve(rootDirectory);
		const realRoot = fs.realpathSync(rootDirectory);
		const absolutePath = path.resolve(candidate);
		if (!isWithinDirectory(absoluteRoot, absolutePath)) return false;

		let existingPath = absolutePath;
		while (!fs.existsSync(existingPath)) {
			const parent = path.dirname(existingPath);
			if (parent === existingPath) return false;
			existingPath = parent;
		}

		const stats = fs.lstatSync(existingPath);
		if (existingPath === absolutePath && stats.isSymbolicLink()) return false;
		return isWithinDirectory(realRoot, fs.realpathSync(existingPath));
	} catch {
		return false;
	}
};

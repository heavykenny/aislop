import path from "node:path";
import { getSourceFiles } from "../utils/source-files.js";
import type { EngineContext } from "./types.js";

const PYTHON_EXTENSIONS = new Set([".py", ".pyi"]);

const normalizeProjectPath = (filePath: string): string => filePath.split(path.sep).join("/");

export const getPythonTargets = (context: EngineContext): string[] => {
	const files = context.files ?? getSourceFiles(context);
	const targets = files
		.filter((filePath) => PYTHON_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
		.map((filePath) => {
			const absolutePath = path.isAbsolute(filePath)
				? filePath
				: path.resolve(context.rootDirectory, filePath);
			return normalizeProjectPath(path.relative(context.rootDirectory, absolutePath));
		})
		.filter((filePath) => filePath.length > 0 && !filePath.startsWith(".."));

	return [...new Set(targets)];
};

export const getRuffDiagnosticPath = (rootDirectory: string, filePath: string): string => {
	const normalizedPath = filePath.replace(/^a\//, "");
	const relativePath = path.isAbsolute(normalizedPath)
		? path.relative(rootDirectory, normalizedPath)
		: normalizedPath;

	return normalizeProjectPath(relativePath);
};

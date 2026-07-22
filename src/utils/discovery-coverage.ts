import path from "node:path";
import {
	filterEnumeratedProjectFiles,
	filterProjectFiles,
	listProjectFiles,
} from "./source-file-selection.js";

export interface Coverage {
	readonly dominantUnsupported: string | null;
	readonly scoreable: boolean;
	readonly supportedFiles: number;
	readonly unsupportedFiles: number;
}

const UNSUPPORTED_CODE_EXTENSIONS: Readonly<Record<string, string>> = {
	".c": "C/C++",
	".h": "C/C++",
	".cc": "C/C++",
	".cpp": "C/C++",
	".cxx": "C/C++",
	".hpp": "C/C++",
	".hh": "C/C++",
	".hxx": "C/C++",
	".cs": "C#",
	".swift": "Swift",
	".kt": "Kotlin",
	".kts": "Kotlin",
	".m": "Objective-C",
	".mm": "Objective-C",
	".scala": "Scala",
	".dart": "Dart",
	".ex": "Elixir",
	".exs": "Elixir",
	".erl": "Erlang",
	".hs": "Haskell",
	".clj": "Clojure",
	".cljs": "Clojure",
	".lua": "Lua",
	".jl": "Julia",
	".zig": "Zig",
	".nim": "Nim",
	".ml": "OCaml",
	".fs": "F#",
	".sol": "Solidity",
	".groovy": "Groovy",
};

export const analyzeCoverage = (
	rootDirectory: string,
	excludePatterns: string[] = [],
	projectFiles?: string[],
): Coverage => {
	const allFiles = projectFiles ?? listProjectFiles(rootDirectory);
	const selectFiles = projectFiles ? filterEnumeratedProjectFiles : filterProjectFiles;
	const supportedFiles = selectFiles(rootDirectory, allFiles, [], excludePatterns).length;
	const counts = new Map<string, number>();
	let unsupportedFiles = 0;
	const candidates = selectFiles(
		rootDirectory,
		allFiles,
		Object.keys(UNSUPPORTED_CODE_EXTENSIONS),
		excludePatterns,
	);
	for (const file of candidates) {
		const language = UNSUPPORTED_CODE_EXTENSIONS[path.extname(file).toLowerCase()];
		if (!language) continue;
		unsupportedFiles++;
		counts.set(language, (counts.get(language) ?? 0) + 1);
	}

	let dominantUnsupported: string | null = null;
	let largestCount = 0;
	for (const [language, count] of counts) {
		if (count <= largestCount) continue;
		largestCount = count;
		dominantUnsupported = language;
	}

	const scoreable = !(
		supportedFiles === 0 ||
		(unsupportedFiles >= 10 && unsupportedFiles > supportedFiles * 3)
	);
	return { supportedFiles, unsupportedFiles, dominantUnsupported, scoreable };
};

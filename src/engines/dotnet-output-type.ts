import fs from "node:fs";
import path from "node:path";
import { findCsprojFiles } from "./dotnet-targets.js";

// `<OutputType>Exe</OutputType>` / `WinExe` mark an executable; anything else
// (including an absent OutputType) is a library.
const OUTPUT_TYPE_RE = /<OutputType>\s*([^<]+?)\s*<\/OutputType>/i;
const EXE_OUTPUT_TYPES = new Set(["exe", "winexe"]);

interface ProjectOutput {
	directory: string;
	isExe: boolean;
}

export interface OutputTypeResolver {
	// True when the .cs file's nearest-ancestor project produces an executable.
	isExeProject(csFileAbsolutePath: string): boolean;
}

const readIsExe = (csprojPath: string): boolean => {
	let xml: string;
	try {
		xml = fs.readFileSync(csprojPath, "utf-8");
	} catch {
		return false;
	}
	const match = OUTPUT_TYPE_RE.exec(xml);
	if (match === null) return false;
	return EXE_OUTPUT_TYPES.has(match[1].trim().toLowerCase());
};

export const buildOutputTypeResolver = (rootDirectory: string): OutputTypeResolver => {
	const projects: ProjectOutput[] = findCsprojFiles(rootDirectory).map((csprojPath) => ({
		directory: path.dirname(path.resolve(csprojPath)),
		isExe: readIsExe(csprojPath),
	}));

	const isExeProject = (csFileAbsolutePath: string): boolean => {
		const fileDir = path.resolve(csFileAbsolutePath);
		let best: ProjectOutput | null = null;
		for (const project of projects) {
			const withSep = project.directory.endsWith(path.sep)
				? project.directory
				: project.directory + path.sep;
			if (fileDir === project.directory || fileDir.startsWith(withSep)) {
				if (best === null || project.directory.length > best.directory.length) {
					best = project;
				}
			}
		}
		return best?.isExe ?? false;
	};

	return { isExeProject };
};

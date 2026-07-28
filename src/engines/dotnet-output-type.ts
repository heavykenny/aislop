import fs from "node:fs";
import path from "node:path";
import { findCsprojFiles } from "./dotnet-targets.js";

// `<OutputType>Exe</OutputType>` / `WinExe` mark an executable, and an
// explicit OutputType always wins. When OutputType is omitted, some SDKs
// default to an executable output themselves; confirmed from the dotnet/sdk
// source, these all set <OutputType>Exe</OutputType> unconditionally in
// their imported props before the project's own PropertyGroup is evaluated:
// - Microsoft.NET.Sdk.Web, via Microsoft.NET.Sdk.Web.ProjectSystem.props
// - Microsoft.NET.Sdk.Worker, via Microsoft.NET.Sdk.Worker.props
// - Microsoft.NET.Sdk.BlazorWebAssembly, via
//   Microsoft.NET.Sdk.BlazorWebAssembly.Current.props
// Everything else, including the plain Microsoft.NET.Sdk and
// Microsoft.NET.Sdk.Razor, defaults to Library.
const PROJECT_SDK_RE = /<Project\s[^>]*\bSdk\s*=\s*"([^"]+)"/i;
const OUTPUT_TYPE_RE = /<OutputType>\s*([^<]+?)\s*<\/OutputType>/i;
const EXE_OUTPUT_TYPES = new Set(["exe", "winexe"]);
const EXE_DEFAULT_SDKS = new Set([
	"microsoft.net.sdk.web",
	"microsoft.net.sdk.worker",
	"microsoft.net.sdk.blazorwebassembly",
]);

// The Sdk attribute allows a semicolon-separated list with an optional
// "/version" suffix (e.g. `Sdk="Microsoft.NET.Sdk.Web/8.0.100"`). MSBuild
// treats both Sdk names and OutputType values as case-insensitive.
const sdkDefaultsToExe = (sdkAttribute: string): boolean =>
	sdkAttribute
		.split(";")
		.map((entry) => entry.trim().split("/")[0].toLowerCase())
		.some((name) => EXE_DEFAULT_SDKS.has(name));

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
	const outputTypeMatch = OUTPUT_TYPE_RE.exec(xml);
	if (outputTypeMatch !== null) {
		return EXE_OUTPUT_TYPES.has(outputTypeMatch[1].trim().toLowerCase());
	}
	const sdkMatch = PROJECT_SDK_RE.exec(xml);
	if (sdkMatch === null) return false;
	return sdkDefaultsToExe(sdkMatch[1]);
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

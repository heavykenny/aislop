import { renderHeader } from "../ui/header.js";
import { createSymbols } from "../ui/symbols.js";
import { createTheme } from "../ui/theme.js";
import type { Coverage, ProjectInfo } from "../utils/discover.js";
import { APP_VERSION } from "../version.js";

export const coverageReason = (c: Coverage): string => {
	if (c.supportedFiles === 0 && c.dominantUnsupported) {
		return `This repository is ${c.dominantUnsupported} (${c.unsupportedFiles} files), which aislop does not analyze. No score — it would not reflect this code.`;
	}
	if (c.supportedFiles === 0) {
		return "No files in a language aislop analyzes (TypeScript, JavaScript, Python, Go, Rust, Ruby, PHP, Java). Nothing to score.";
	}
	const lang = c.dominantUnsupported ?? "an unsupported language";
	const files = `${c.supportedFiles} supported file${c.supportedFiles === 1 ? "" : "s"}`;
	return `This repository is mostly ${lang} (${c.unsupportedFiles} files); aislop analyzed only ${files}. Score withheld — it would represent a sliver of the codebase.`;
};

export const renderCoverageNotice = (projectInfo: ProjectInfo, includeHeader: boolean): string => {
	const deps = {
		theme: createTheme(),
		symbols: createSymbols({ plain: false }),
	};
	const header =
		includeHeader === false
			? ""
			: renderHeader(
					{
						version: APP_VERSION,
						command: "Scan result",
						context: [
							projectInfo.projectName,
							projectInfo.languages[0] ?? "unknown",
							`${projectInfo.sourceFileCount} files`,
						],
						brand: true,
					},
					deps,
				);
	return `${header}  ${coverageReason(projectInfo.coverage)}\n\n`;
};

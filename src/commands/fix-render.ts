import { renderHeader } from "../ui/header.js";
import { renderHintLine } from "../ui/logger.js";
import { type RailStep, renderRail } from "../ui/rail.js";
import { createSymbols } from "../ui/symbols.js";
import { createTheme } from "../ui/theme.js";
import { APP_VERSION } from "../version.js";

interface BuildFixRenderInput {
	projectName: string;
	steps: RailStep[];
	fixed: number;
	remaining: number;
	nextAgentHint?: string;
	includeHeader?: boolean;
	printBrand?: boolean;
}

export const buildFixRender = (input: BuildFixRenderInput): string => {
	// Render with TTY symbols + auto-detected theme so snapshots are deterministic.
	// Colors still reflect the terminal (they strip cleanly with ANSI_RE in tests).
	const deps = {
		theme: createTheme(),
		symbols: createSymbols({ plain: false }),
	};
	const header =
		input.includeHeader === false
			? ""
			: renderHeader(
					{
						version: APP_VERSION,
						command: "fix",
						context: [input.projectName],
						brand: input.printBrand !== false,
					},
					deps,
				);
	const rail = renderRail(
		{
			steps: input.steps,
			footer: `Done · ${input.fixed} fixed · ${input.remaining} remain`,
		},
		deps,
	);
	const tail =
		input.remaining > 0 && input.nextAgentHint
			? `\n${renderHintLine(input.nextAgentHint, deps)}`
			: "";
	return `${header}${rail}${tail}`;
};

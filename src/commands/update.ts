import { renderHeader } from "../ui/header.js";
import { style, theme } from "../ui/theme.js";
import { fetchLatestVersion, isOutdated } from "../update-notifier.js";
import { APP_VERSION } from "../version.js";

interface UpdateOptions {
	printBrand?: boolean;
}

interface UpdateStatusInput {
	current: string;
	latest: string | null;
}

const renderUpgradeHelp = (label = "Upgrade:"): string =>
	[
		`${style(theme, "dim", label)}`,
		"  npm i -g aislop@latest",
		"",
		`${style(theme, "dim", "One-off latest run:")}`,
		"  npx aislop@latest",
		"",
	].join("\n");

export const buildUpdateStatusRender = (input: UpdateStatusInput): string => {
	const lines = [`Current: ${input.current}`, `Latest:  ${input.latest ?? "unavailable"}`, ""];

	if (!input.latest) {
		lines.push("Status: could not reach the npm registry right now.", "");
		lines.push(renderUpgradeHelp("Use latest when npm is reachable:").trimEnd());
		return `${lines.join("\n")}\n`;
	}

	if (isOutdated(input.current, input.latest)) {
		lines.push(`Status: update available (${input.current} -> ${input.latest}).`, "");
		lines.push(renderUpgradeHelp("Upgrade:").trimEnd());
		return `${lines.join("\n")}\n`;
	}

	lines.push("Status: aislop is up to date.", "");
	lines.push(renderUpgradeHelp("Latest commands:").trimEnd());
	return `${lines.join("\n")}\n`;
};

export const updateCommand = async (options: UpdateOptions = {}): Promise<void> => {
	if (options.printBrand !== false) {
		process.stdout.write(
			renderHeader({ version: APP_VERSION, command: "Update check", context: ["npm"] }),
		);
	}

	const latest = await fetchLatestVersion();

	process.stdout.write(buildUpdateStatusRender({ current: APP_VERSION, latest }));
};

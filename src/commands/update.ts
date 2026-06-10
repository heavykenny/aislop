import {
	renderDisplayCommandRows,
	renderDisplayRows,
	renderDisplaySection,
} from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { fetchLatestVersion, isOutdated } from "../update-notifier.js";
import { APP_VERSION } from "../version.js";

interface UpdateOptions {
	printBrand?: boolean;
}

interface UpdateStatusInput {
	current: string;
	latest: string | null;
}

export const buildUpdateStatusRender = (input: UpdateStatusInput): string => {
	const state = !input.latest
		? "could not reach the npm registry right now."
		: isOutdated(input.current, input.latest)
			? `update available (${input.current} -> ${input.latest}).`
			: "aislop is up to date.";

	const lines = [
		renderDisplaySection("Status"),
		...renderDisplayRows([
			{ label: "Current", value: input.current },
			{ label: "Latest", value: input.latest ?? "unavailable" },
			{ label: "State", value: state },
		]),
		"",
		renderDisplaySection("Commands"),
		...renderDisplayCommandRows([
			{ label: "Upgrade", command: "npm i -g aislop@latest" },
			{ label: "One-off", command: "npx aislop@latest" },
		]),
	];
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

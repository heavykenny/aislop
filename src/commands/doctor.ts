import path from "node:path";
import { loadConfig } from "../config/index.js";
import {
	type DisplayRow,
	type DisplayStatusItem,
	renderDisplayRows,
	renderDisplaySection,
	renderDisplayStatusItems,
} from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { detectInvocation } from "../ui/invocation.js";
import { style, theme } from "../ui/theme.js";
import { discoverProject } from "../utils/discover.js";
import { APP_VERSION } from "../version.js";
import { buildRows, type DoctorEngineRow, languageLabelFor } from "./doctor-plan.js";

export type { DoctorEngineRow } from "./doctor-plan.js";
export { planFormatForTest, planLintForTest } from "./doctor-plan.js";

interface BuildDoctorRenderInput {
	projectName: string;
	languageLabel: string;
	rows: DoctorEngineRow[];
	invocation: string;
	printBrand?: boolean;
}

const doctorMarker = (row: DoctorEngineRow): string => {
	if (row.status === "missing") return style(theme, "danger", "✗");
	if (row.status === "skipped") return style(theme, "muted", "·");
	return style(theme, "success", "✓");
};

const doctorState = (row: DoctorEngineRow): string => {
	if (row.status === "missing") return "missing";
	if (row.status === "skipped") return "skipped";
	return "ready";
};

const renderToolCell = (row: DoctorEngineRow): string => {
	if (row.status === "missing") {
		return style(theme, "danger", row.tool);
	}
	return style(theme, "muted", row.tool);
};

const doctorItem = (row: DoctorEngineRow): DisplayStatusItem => {
	const rows: DisplayRow[] = [
		{ label: "Status", value: doctorState(row) },
		{ label: "Tool", value: renderToolCell(row) },
	];
	if (row.skipReason) rows.push({ label: "Reason", value: row.skipReason });
	if (row.remediation) rows.push({ label: "Fix", value: row.remediation });
	return { marker: doctorMarker(row), label: row.engine, rows };
};

export const buildDoctorRender = (input: BuildDoctorRenderInput): string => {
	const header = renderHeader({
		version: APP_VERSION,
		command: "Doctor report",
		context: [input.projectName, input.languageLabel].filter((s) => s.length > 0),
		brand: input.printBrand !== false,
	});

	const enginesRunning = input.rows.filter((r) => r.status === "ok").length;
	const missing = input.rows.filter((r) => r.status === "missing").length;
	const skipped = input.rows.filter((r) => r.status === "skipped").length;
	const nextRows: DisplayRow[] =
		missing > 0
			? [
					{ label: "Action", value: "Install the missing tools" },
					{ label: "Then", value: `${input.invocation} scan` },
				]
			: [{ label: "Scan", value: `${input.invocation} scan` }];

	const lines = [
		header.trimEnd(),
		"",
		renderDisplaySection("Engines"),
		...renderDisplayStatusItems(input.rows.map(doctorItem)),
		"",
		renderDisplaySection("Summary"),
		...renderDisplayRows([
			{ label: "Ready", value: `${enginesRunning} engines` },
			{ label: "Missing", value: String(missing) },
			{ label: "Skipped", value: String(skipped) },
		]),
		"",
		renderDisplaySection(missing > 0 ? "Fix" : "Next"),
		...renderDisplayRows(nextRows),
	];
	return `${lines.join("\n")}\n`;
};

interface DoctorOptions {
	printBrand?: boolean;
}

export const doctorCommand = async (
	directory: string,
	options: DoctorOptions = {},
): Promise<void> => {
	const resolvedDir = path.resolve(directory);
	const projectInfo = await discoverProject(resolvedDir);
	const config = loadConfig(resolvedDir);

	const rows = buildRows({ rootDirectory: resolvedDir, projectInfo, config });

	process.stdout.write(
		buildDoctorRender({
			projectName: projectInfo.projectName,
			languageLabel: languageLabelFor(projectInfo),
			rows,
			invocation: detectInvocation(),
			printBrand: options.printBrand,
		}),
	);
};

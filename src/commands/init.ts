import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
	DEFAULT_CONFIG,
	DEFAULT_GITHUB_WORKFLOW_YAML,
	DEFAULT_RULES_YAML,
	GITHUB_WORKFLOW_DIR,
	GITHUB_WORKFLOW_FILE,
} from "../config/defaults.js";
import { CONFIG_DIR, CONFIG_FILE, RULES_FILE } from "../config/index.js";
import { renderHeader } from "../ui/header.js";
import { detectInvocation } from "../ui/invocation.js";
import { renderHintLine } from "../ui/logger.js";
import { isCancel, multiselect, select, text } from "../ui/prompts.js";
import { type RailStep, renderRail } from "../ui/rail.js";
import { createSymbols } from "../ui/symbols.js";
import { createTheme } from "../ui/theme.js";
import { APP_VERSION } from "../version.js";

interface BuildInitRenderInput {
	steps: RailStep[];
	nextCommand: string;
	includeHeader?: boolean;
	printBrand?: boolean;
}

export const buildInitSuccessRender = (input: BuildInitRenderInput): string => {
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
						command: "init",
						context: [],
						brand: input.printBrand !== false,
					},
					deps,
				);
	const writtenCount = input.steps.filter((s) => s.status === "done").length;
	const footer =
		writtenCount === 0
			? "Nothing to write"
			: `Done · wrote ${writtenCount} file${writtenCount === 1 ? "" : "s"}`;
	const rail = renderRail({ steps: input.steps, footer }, deps);
	return `${header}${rail}\n${renderHintLine(`Try ${input.nextCommand}`, deps)}`;
};

type EngineKey = keyof typeof DEFAULT_CONFIG.engines;

const ENGINE_CHOICES: { value: EngineKey; label: string; hint?: string }[] = [
	{ value: "format", label: "format", hint: "Biome / gofmt / ruff" },
	{ value: "lint", label: "lint", hint: "oxlint / ruff" },
	{ value: "code-quality", label: "code-quality", hint: "knip / complexity" },
	{ value: "ai-slop", label: "ai-slop", hint: "dead patterns, unused imports" },
	{ value: "architecture", label: "architecture", hint: "BYO rules" },
	{ value: "security", label: "security", hint: "dependency audit" },
];

const DEFAULT_ENGINE_SELECTION: EngineKey[] = (
	Object.keys(DEFAULT_CONFIG.engines) as EngineKey[]
).filter((key) => DEFAULT_CONFIG.engines[key]);

interface InitChoices {
	engines: EngineKey[];
	failBelow: number;
	telemetryEnabled: boolean;
	writeGithubWorkflow: boolean;
}

type WorkflowWriteResult =
	| { status: "written"; relativePath: string }
	| { status: "skipped-exists"; relativePath: string }
	| { status: "declined" };

export const writeGithubWorkflow = (
	rootDirectory: string,
	enabled: boolean,
): WorkflowWriteResult => {
	const relativePath = `${GITHUB_WORKFLOW_DIR}/${GITHUB_WORKFLOW_FILE}`;
	if (!enabled) return { status: "declined" };

	const workflowDir = path.join(rootDirectory, GITHUB_WORKFLOW_DIR);
	const workflowPath = path.join(workflowDir, GITHUB_WORKFLOW_FILE);

	if (fs.existsSync(workflowPath)) {
		return { status: "skipped-exists", relativePath };
	}

	fs.mkdirSync(workflowDir, { recursive: true });
	fs.writeFileSync(workflowPath, DEFAULT_GITHUB_WORKFLOW_YAML);
	return { status: "written", relativePath };
};

const promptForConfigChoices = async (): Promise<InitChoices | null> => {
	const enginesSelection = await multiselect<EngineKey>({
		message: "Which engines should run?",
		options: ENGINE_CHOICES,
		initialValues: DEFAULT_ENGINE_SELECTION,
		required: false,
	});
	if (isCancel(enginesSelection)) return null;

	const failBelowRaw = await text({
		message: "CI quality gate — fail the build when the score drops below (0-100)",
		initialValue: "70",
		validate: (v) => {
			const n = Number(v);
			if (!Number.isInteger(n) || n < 0 || n > 100) return "Enter a whole number 0-100";
			return undefined;
		},
	});
	if (isCancel(failBelowRaw)) return null;

	const telemetryChoice = await select<"enabled" | "disabled">({
		message: "Share anonymous usage stats so aislop can improve?",
		options: [
			{ value: "enabled", label: "Yes" },
			{ value: "disabled", label: "No" },
		],
		initialValue: DEFAULT_CONFIG.telemetry.enabled ? "enabled" : "disabled",
	});
	if (isCancel(telemetryChoice)) return null;

	const workflowChoice = await select<"yes" | "no">({
		message: "Add a GitHub Actions workflow to run aislop on every push and PR?",
		options: [
			{ value: "yes", label: "Yes — writes .github/workflows/aislop.yml" },
			{ value: "no", label: "No, I'll wire CI myself" },
		],
		initialValue: "yes",
	});
	if (isCancel(workflowChoice)) return null;

	return {
		engines: enginesSelection,
		failBelow: Number(failBelowRaw),
		telemetryEnabled: telemetryChoice === "enabled",
		writeGithubWorkflow: workflowChoice === "yes",
	};
};

const writeAislopConfig = (configDir: string, configPath: string, choices: InitChoices): void => {
	const selected = new Set(choices.engines);
	const engines: typeof DEFAULT_CONFIG.engines = {
		format: selected.has("format"),
		lint: selected.has("lint"),
		"code-quality": selected.has("code-quality"),
		"ai-slop": selected.has("ai-slop"),
		architecture: selected.has("architecture"),
		security: selected.has("security"),
	};

	const configDocument = {
		version: DEFAULT_CONFIG.version,
		engines,
		quality: { ...DEFAULT_CONFIG.quality },
		security: { ...DEFAULT_CONFIG.security },
		scoring: {
			weights: { ...DEFAULT_CONFIG.scoring.weights },
			thresholds: { ...DEFAULT_CONFIG.scoring.thresholds },
			smoothing: DEFAULT_CONFIG.scoring.smoothing,
		},
		ci: {
			failBelow: choices.failBelow,
			format: DEFAULT_CONFIG.ci.format,
		},
		telemetry: {
			enabled: choices.telemetryEnabled,
		},
	};

	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, { recursive: true });
	}

	fs.writeFileSync(configPath, YAML.stringify(configDocument));
};

interface InitOptions {
	printBrand?: boolean;
}

export const initCommand = async (directory: string, options: InitOptions = {}): Promise<void> => {
	const resolvedDir = path.resolve(directory);
	const printBrand = options.printBrand !== false;

	process.stdout.write(
		renderHeader({ version: APP_VERSION, command: "init", context: [], brand: printBrand }),
	);

	const configDir = path.join(resolvedDir, CONFIG_DIR);
	const configPath = path.join(configDir, CONFIG_FILE);
	const rulesPath = path.join(configDir, RULES_FILE);
	const invocation = detectInvocation();

	if (fs.existsSync(configPath)) {
		const overwrite = await select<"keep" | "overwrite">({
			message: `${CONFIG_DIR}/${CONFIG_FILE} already exists. What now?`,
			options: [
				{ value: "keep", label: "Keep existing config" },
				{ value: "overwrite", label: "Overwrite with new answers" },
			],
			initialValue: "keep",
		});
		if (isCancel(overwrite) || overwrite === "keep") {
			process.stdout.write(
				buildInitSuccessRender({
					steps: [
						{
							status: "skipped",
							label: `Kept existing ${CONFIG_DIR}/${CONFIG_FILE}`,
						},
					],
					nextCommand: `${invocation} scan`,
					includeHeader: false,
				}),
			);
			return;
		}
	}

	const choices = await promptForConfigChoices();
	if (!choices) return;

	writeAislopConfig(configDir, configPath, choices);

	const steps: RailStep[] = [{ status: "done", label: `Wrote ${CONFIG_DIR}/${CONFIG_FILE}` }];

	if (choices.engines.includes("architecture")) {
		if (!fs.existsSync(rulesPath)) {
			fs.writeFileSync(rulesPath, DEFAULT_RULES_YAML);
			steps.push({ status: "done", label: `Wrote ${CONFIG_DIR}/${RULES_FILE}` });
		} else {
			steps.push({
				status: "skipped",
				label: `${CONFIG_DIR}/${RULES_FILE} already exists`,
			});
		}
	}

	const workflowResult = writeGithubWorkflow(resolvedDir, choices.writeGithubWorkflow);
	if (workflowResult.status === "written") {
		steps.push({ status: "done", label: `Wrote ${workflowResult.relativePath}` });
	} else if (workflowResult.status === "skipped-exists") {
		steps.push({
			status: "skipped",
			label: `${workflowResult.relativePath} already exists`,
		});
	}

	process.stdout.write(
		buildInitSuccessRender({
			steps,
			nextCommand: `${invocation} scan`,
			includeHeader: false,
		}),
	);
};

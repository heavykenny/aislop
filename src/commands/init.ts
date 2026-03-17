import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG_YAML, DEFAULT_RULES_YAML } from "../config/defaults.js";
import { CONFIG_DIR, CONFIG_FILE, RULES_FILE } from "../config/index.js";
import {
	formatProjectSummary,
	printCommandHeader,
	printProjectMetadata,
} from "../output/layout.js";
import { discoverProject } from "../utils/discover.js";
import { highlighter } from "../utils/highlighter.js";
import { logger } from "../utils/logger.js";
import { spinner } from "../utils/spinner.js";

export const initCommand = async (directory: string): Promise<void> => {
	const resolvedDir = path.resolve(directory);

	printCommandHeader("Init");

	const s1 = spinner("Detecting project...").start();
	const projectInfo = await discoverProject(resolvedDir);
	s1.stop();
	logger.success(`  ✓ ${formatProjectSummary(projectInfo)}`);
	printProjectMetadata(projectInfo);

	const configDir = path.join(resolvedDir, CONFIG_DIR);
	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, { recursive: true });
	}

	const configPath = path.join(configDir, CONFIG_FILE);
	if (fs.existsSync(configPath)) {
		logger.dim(`  ${CONFIG_DIR}/${CONFIG_FILE} already exists, skipping`);
	} else {
		fs.writeFileSync(configPath, DEFAULT_CONFIG_YAML);
		const s2 = spinner(`Creating ${CONFIG_DIR}/${CONFIG_FILE}...`).start();
		s2.succeed(`Created ${highlighter.info(`${CONFIG_DIR}/${CONFIG_FILE}`)}`);
	}

	const rulesPath = path.join(configDir, RULES_FILE);
	if (fs.existsSync(rulesPath)) {
		logger.dim(`  ${CONFIG_DIR}/${RULES_FILE} already exists, skipping`);
	} else {
		fs.writeFileSync(rulesPath, DEFAULT_RULES_YAML);
		const s3 = spinner(`Creating ${CONFIG_DIR}/${RULES_FILE}...`).start();
		s3.succeed(`Created ${highlighter.info(`${CONFIG_DIR}/${RULES_FILE}`)}`);
	}

	logger.break();
	logger.log("  Next steps:");
	logger.dim("  1. Edit .aislop/config.yml to customize engines and thresholds");
	logger.dim("  2. Edit .aislop/rules.yml to add architecture rules");
	logger.dim("  3. Run `aislop scan` to see your score");
	logger.dim("  4. Add `aislop scan --staged` to your pre-commit hook");
	logger.break();
};

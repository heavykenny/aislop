import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { DEFAULT_CONFIG } from "./defaults.js";
import { parseConfig, type SlopConfig } from "./schema.js";

export const CONFIG_DIR = ".slop";
export const CONFIG_FILE = "config.yml";
export const RULES_FILE = "rules.yml";

export const findConfigDir = (startDir: string): string | null => {
	let current = path.resolve(startDir);
	while (true) {
		const candidate = path.join(current, CONFIG_DIR);
		if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
			return candidate;
		}
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
};

export const loadConfig = (directory: string): SlopConfig => {
	const configDir = findConfigDir(directory);
	if (!configDir) return DEFAULT_CONFIG;

	const configPath = path.join(configDir, CONFIG_FILE);
	if (!fs.existsSync(configPath)) return DEFAULT_CONFIG;

	try {
		const raw = fs.readFileSync(configPath, "utf-8");
		const parsed = YAML.parse(raw);
		return parseConfig(parsed);
	} catch {
		return DEFAULT_CONFIG;
	}
};

export type { SlopConfig } from "./schema.js";

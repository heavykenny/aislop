import type { SlopConfig } from "../config/index.js";
import { scanCommand } from "./scan.js";

export const ciCommand = async (
	directory: string,
	config: SlopConfig,
): Promise<{ exitCode: number }> => {
	return scanCommand(directory, config, {
		changes: false,
		staged: false,
		verbose: false,
		json: true,
	});
};

import type { AislopConfig } from "../config/index.js";
import { scanCommand } from "./scan.js";

export const ciCommand = async (
	directory: string,
	config: AislopConfig,
): Promise<{ exitCode: number }> => {
	return scanCommand(directory, config, {
		changes: false,
		staged: false,
		verbose: false,
		json: true,
	});
};

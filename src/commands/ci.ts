import type { AislopConfig } from "../config/index.js";
import { renderError } from "../ui/error.js";
import { scanCommand } from "./scan.js";

interface CiOptions {
	human?: boolean;
}

export const ciCommand = async (
	directory: string,
	config: AislopConfig,
	options: CiOptions = {},
): Promise<{ exitCode: number }> => {
	try {
		return await scanCommand(directory, config, {
			changes: false,
			staged: false,
			verbose: false,
			json: !options.human,
			command: "ci",
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(
			renderError({
				message: "ci command failed",
				cause: message,
			}),
		);
		return { exitCode: 1 };
	}
};

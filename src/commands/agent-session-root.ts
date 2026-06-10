import path from "node:path";
import { runSubprocess } from "../utils/subprocess.js";

export const resolveAgentGitRoot = async (directory: string): Promise<string> => {
	const result = await runSubprocess("git", ["rev-parse", "--show-toplevel"], {
		cwd: path.resolve(directory),
	});
	if (result.exitCode !== 0 || !result.stdout.trim()) {
		throw new Error("Agent sessions need to be read from inside a git repository.");
	}
	return result.stdout.trim();
};

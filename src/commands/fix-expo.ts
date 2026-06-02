import type { EngineContext } from "../engines/types.js";
import { runSubprocess } from "../utils/subprocess.js";

const INSTALL_TIMEOUT = 30 * 60 * 1000;

export const fixExpoDependencies = async (
	context: EngineContext,
	onProgress?: (label: string) => void,
): Promise<void> => {
	await removeDisallowedExpoPackages(context.rootDirectory, onProgress);

	onProgress?.("Expo dependency alignment · running expo install --fix (can take a few minutes)");
	const fixResult = await runSubprocess("npx", ["--yes", "expo", "install", "--fix"], {
		cwd: context.rootDirectory,
		timeout: INSTALL_TIMEOUT,
	});

	if (fixResult.exitCode === 0) return;

	onProgress?.("Expo dependency alignment · checking remaining issues");
	const checkResult = await runSubprocess("npx", ["--yes", "expo", "install", "--check"], {
		cwd: context.rootDirectory,
		timeout: INSTALL_TIMEOUT,
	});

	if (checkResult.exitCode !== 0) {
		throw new Error(checkResult.stderr || checkResult.stdout || "expo dependency check failed");
	}
};

/**
 * Run expo-doctor to detect packages that should not be installed directly,
 * then uninstall them. No hardcoded list — expo-doctor is the source of truth.
 */
const removeDisallowedExpoPackages = async (
	rootDir: string,
	onProgress?: (label: string) => void,
): Promise<void> => {
	try {
		onProgress?.("Expo dependency alignment · running expo-doctor");
		const result = await runSubprocess("npx", ["--yes", "expo-doctor", rootDir], {
			cwd: rootDir,
			timeout: INSTALL_TIMEOUT,
		});
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");

		const packagePattern = /The package "([^"]+)" should not be installed directly/g;
		const toRemove: string[] = [];
		for (const match of output.matchAll(packagePattern)) {
			toRemove.push(match[1]);
		}

		if (toRemove.length === 0) return;

		onProgress?.(`Expo dependency alignment · uninstalling ${toRemove.length} package(s)`);
		await runSubprocess("npm", ["uninstall", ...toRemove], {
			cwd: rootDir,
			timeout: INSTALL_TIMEOUT,
		});
	} catch {
		// Best-effort — don't fail the step
	}
};

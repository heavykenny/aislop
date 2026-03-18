import fs from "node:fs";
import path from "node:path";
import type { EngineContext } from "../engines/types.js";
import { runSubprocess } from "../utils/subprocess.js";

const getJsAuditFixCommand = (
	rootDirectory: string,
): { command: string; args: string[] } | null => {
	if (fs.existsSync(path.join(rootDirectory, "pnpm-lock.yaml"))) {
		return { command: "pnpm", args: ["audit", "--fix"] };
	}

	if (
		fs.existsSync(path.join(rootDirectory, "package-lock.json")) ||
		fs.existsSync(path.join(rootDirectory, "package.json"))
	) {
		return { command: "npm", args: ["audit", "fix"] };
	}

	return null;
};

export const fixDependencyAudit = async (context: EngineContext): Promise<void> => {
	const auditFix = getJsAuditFixCommand(context.rootDirectory);
	if (!auditFix) return;

	const result = await runSubprocess(auditFix.command, auditFix.args, {
		cwd: context.rootDirectory,
		timeout: 180000,
	});

	if (result.exitCode !== 0) {
		throw new Error(result.stderr || result.stdout || `${auditFix.command} audit fix failed`);
	}
};

export const fixExpoDependencies = async (context: EngineContext): Promise<void> => {
	const fixResult = await runSubprocess("npx", ["--yes", "expo", "install", "--fix"], {
		cwd: context.rootDirectory,
		timeout: 180000,
	});

	if (fixResult.exitCode === 0) return;

	const checkResult = await runSubprocess("npx", ["--yes", "expo", "install", "--check"], {
		cwd: context.rootDirectory,
		timeout: 180000,
	});

	if (checkResult.exitCode !== 0) {
		throw new Error(checkResult.stderr || checkResult.stdout || "expo dependency check failed");
	}
};

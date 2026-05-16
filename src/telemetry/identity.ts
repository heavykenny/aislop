import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILE_BASENAME = "install_id";

export const resolveInstallIdPath = (
	homedir: string = os.homedir(),
	env: NodeJS.ProcessEnv = process.env,
): string => {
	if (process.platform === "linux" && env.XDG_STATE_HOME) {
		return path.join(env.XDG_STATE_HOME, "aislop", FILE_BASENAME);
	}
	return path.join(homedir, ".aislop", FILE_BASENAME);
};

interface EnsureResult {
	installId: string;
	created: boolean;
}

export const ensureInstallId = (idPath: string = resolveInstallIdPath()): EnsureResult => {
	if (fs.existsSync(idPath)) {
		const existing = fs.readFileSync(idPath, "utf-8").trim();
		if (existing.length > 0) return { installId: existing, created: false };
	}

	const dir = path.dirname(idPath);
	fs.mkdirSync(dir, { recursive: true });

	const installId = randomUUID();
	const tmpPath = `${idPath}.${process.pid}.tmp`;
	fs.writeFileSync(tmpPath, `${installId}\n`, { mode: 0o600 });

	try {
		fs.renameSync(tmpPath, idPath);
		return { installId, created: true };
	} catch {
		fs.rmSync(tmpPath, { force: true });
		const resolved = fs.readFileSync(idPath, "utf-8").trim();
		return { installId: resolved, created: false };
	}
};

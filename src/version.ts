import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const versionFromPackageJson = (): string => {
	try {
		const dir = dirname(fileURLToPath(import.meta.url));
		return (JSON.parse(readFileSync(join(dir, "../package.json"), "utf8")) as { version: string })
			.version;
	} catch {
		return "0.0.0";
	}
};

// Bundled builds inject VERSION from package.json; the fallback keeps source/dev runs in sync.
export const APP_VERSION = process.env.VERSION ?? versionFromPackageJson();

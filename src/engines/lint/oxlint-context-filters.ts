import fs from "node:fs";
import path from "node:path";

const AMBIENT_GLOBAL_DEPS = ["unplugin-icons", "@types/bun", "bun-types"] as const;
type AmbientSource = (typeof AMBIENT_GLOBAL_DEPS)[number];

const SST_PLATFORM_REF_RE =
	/\/\/\/\s*<reference\s+path=["'][^"']*sst[\\/]+platform[\\/]+config\.d\.ts["']/;
const ICON_AUTOIMPORT_RE = /^Icon[A-Z]/;
const NO_UNDEF_IDENT_RE = /^['‘"`]([^'’"`]+)['’"`]/;

export const detectAmbientSources = (rootDir: string): Set<AmbientSource> => {
	const found = new Set<AmbientSource>();
	const skipDirs = new Set([
		"node_modules",
		".git",
		"dist",
		"build",
		"out",
		"target",
		"coverage",
		".next",
		".turbo",
	]);
	const walk = (dir: string, depth: number): void => {
		if (depth > 4 || found.size === AMBIENT_GLOBAL_DEPS.length) return;
		let entries: import("node:fs").Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (found.size === AMBIENT_GLOBAL_DEPS.length) return;
			if (entry.name.startsWith(".") && entry.name !== ".github") continue;
			if (skipDirs.has(entry.name)) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full, depth + 1);
			} else if (entry.name === "package.json") {
				try {
					const pkg = JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
					const allDeps = {
						...((pkg.dependencies ?? {}) as Record<string, unknown>),
						...((pkg.devDependencies ?? {}) as Record<string, unknown>),
						...((pkg.peerDependencies ?? {}) as Record<string, unknown>),
					};
					for (const dep of AMBIENT_GLOBAL_DEPS) {
						if (dep in allDeps) found.add(dep);
					}
				} catch {
					// ignore malformed manifests
				}
			}
		}
	};
	walk(rootDir, 0);
	return found;
};

const extractNoUndefIdentifier = (message: string): string | null => {
	const match = NO_UNDEF_IDENT_RE.exec(message);
	return match?.[1] ?? null;
};

export const isAmbientFalsePositive = (
	rule: string,
	message: string,
	sources: Set<AmbientSource>,
): boolean => {
	if (rule !== "eslint/no-undef") return false;
	const ident = extractNoUndefIdentifier(message);
	if (!ident) return false;
	if (sources.has("unplugin-icons") && ICON_AUTOIMPORT_RE.test(ident)) return true;
	if ((sources.has("@types/bun") || sources.has("bun-types")) && ident === "Bun") return true;
	return false;
};

const sstReferencedFiles = new Map<string, boolean>();

export const clearSstReferenceCache = (): void => {
	sstReferencedFiles.clear();
};

export const fileReferencesSstPlatform = (rootDir: string, relativeFilePath: string): boolean => {
	const cached = sstReferencedFiles.get(relativeFilePath);
	if (cached !== undefined) return cached;
	const absolute = path.isAbsolute(relativeFilePath)
		? relativeFilePath
		: path.join(rootDir, relativeFilePath);
	let referenced = false;
	try {
		const fd = fs.openSync(absolute, "r");
		try {
			const buf = Buffer.alloc(512);
			const bytesRead = fs.readSync(fd, buf, 0, 512, 0);
			referenced = SST_PLATFORM_REF_RE.test(buf.toString("utf-8", 0, bytesRead));
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		referenced = false;
	}
	sstReferencedFiles.set(relativeFilePath, referenced);
	return referenced;
};

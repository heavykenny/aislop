import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const MAX_DEPTH = 5;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

// child wins on scalar conflict, plain objects deep-merge, arrays replace.
const deepMerge = (...sources: Record<string, unknown>[]): Record<string, unknown> => {
	const result: Record<string, unknown> = {};
	for (const source of sources) {
		for (const key of Object.keys(source)) {
			const a = result[key];
			const b = source[key];
			result[key] = isPlainObject(a) && isPlainObject(b) ? deepMerge(a, b) : b;
		}
	}
	return result;
};

const resolveExtendsRef = (ref: string, fromDir: string): string => {
	if (ref.startsWith("http://") || ref.startsWith("https://")) {
		throw new Error(`URL-based extends not yet supported: ${ref}`);
	}
	if (ref.startsWith("./") || ref.startsWith("../") || path.isAbsolute(ref)) {
		return path.resolve(fromDir, ref);
	}
	throw new Error(`Package-name extends not yet supported: ${ref} (use a relative path for now)`);
};

const normalizeExtends = (raw: unknown): string[] => {
	if (raw === undefined || raw === null) return [];
	if (typeof raw === "string") return [raw];
	if (Array.isArray(raw) && raw.every((s) => typeof s === "string")) {
		return raw;
	}
	throw new Error("`extends` must be a string or array of strings");
};

export const loadConfigChain = (
	configPath: string,
	visited: ReadonlySet<string> = new Set(),
	depth = 0,
): Record<string, unknown> => {
	if (depth > MAX_DEPTH) {
		throw new Error(`extends depth exceeded ${MAX_DEPTH} (cycle or runaway chain): ${configPath}`);
	}
	const absPath = path.resolve(configPath);
	if (visited.has(absPath)) {
		throw new Error(`circular extends detected: ${absPath}`);
	}
	if (!fs.existsSync(absPath)) {
		throw new Error(`extends target not found: ${absPath}`);
	}
	const nextVisited = new Set(visited);
	nextVisited.add(absPath);

	const raw = fs.readFileSync(absPath, "utf-8");
	const parsed = (YAML.parse(raw) ?? {}) as Record<string, unknown>;

	const refs = normalizeExtends(parsed.extends);
	const fromDir = path.dirname(absPath);
	const parents = refs.map((ref) => {
		const parentPath = resolveExtendsRef(ref, fromDir);
		return loadConfigChain(parentPath, nextVisited, depth + 1);
	});

	const { extends: _drop, ...own } = parsed;
	return deepMerge(...parents, own);
};

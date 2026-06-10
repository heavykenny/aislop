import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const MAX_DEPTH = 5;
const MAX_CONFIG_BYTES = 1024 * 1024;

type LoadConfigChainOptions = {
	rootDir?: string;
	maxBytes?: number;
};

type LoadConfigChainState = Required<LoadConfigChainOptions> & {
	visited: ReadonlySet<string>;
};

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

const findGitRoot = (startDir: string): string | null => {
	let current = path.resolve(startDir);
	while (true) {
		if (fs.existsSync(path.join(current, ".git"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
};

const isPathInside = (candidate: string, root: string): boolean => {
	const rel = path.relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const resolveExtendsRef = (ref: string, fromDir: string): string => {
	if (ref.startsWith("http://") || ref.startsWith("https://")) {
		throw new Error(`URL-based extends not yet supported: ${ref}`);
	}
	if (path.isAbsolute(ref)) {
		throw new Error(`Absolute extends paths are not allowed: ${ref}`);
	}
	if (ref.startsWith("./") || ref.startsWith("../")) {
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

const assertReadableConfigFile = (configPath: string, state: LoadConfigChainState): string => {
	let realPath: string;
	try {
		realPath = fs.realpathSync(configPath);
	} catch {
		throw new Error(`extends target not found: ${path.resolve(configPath)}`);
	}
	if (!isPathInside(realPath, state.rootDir)) {
		throw new Error(`extends target must stay within ${state.rootDir}: ${realPath}`);
	}
	const stats = fs.statSync(realPath);
	if (!stats.isFile()) {
		throw new Error(`extends target must be a regular file: ${realPath}`);
	}
	if (stats.size > state.maxBytes) {
		throw new Error(`extends target is too large (${stats.size} bytes): ${realPath}`);
	}
	return realPath;
};

const loadConfigChainInner = (
	configPath: string,
	state: LoadConfigChainState,
	depth: number,
): Record<string, unknown> => {
	if (depth > MAX_DEPTH) {
		throw new Error(`extends depth exceeded ${MAX_DEPTH} (cycle or runaway chain): ${configPath}`);
	}
	const absPath = assertReadableConfigFile(configPath, state);
	if (state.visited.has(absPath)) {
		throw new Error(`circular extends detected: ${absPath}`);
	}
	const nextState = { ...state, visited: new Set(state.visited).add(absPath) };

	const raw = fs.readFileSync(absPath, "utf-8");
	const parsed = (YAML.parse(raw) ?? {}) as Record<string, unknown>;

	const refs = normalizeExtends(parsed.extends);
	const fromDir = path.dirname(absPath);
	const parents = refs.map((ref) => {
		const parentPath = resolveExtendsRef(ref, fromDir);
		return loadConfigChainInner(parentPath, nextState, depth + 1);
	});

	const { extends: _drop, ...own } = parsed;
	return deepMerge(...parents, own);
};

export const loadConfigChain = (
	configPath: string,
	options: LoadConfigChainOptions = {},
): Record<string, unknown> => {
	const configDir = path.dirname(path.resolve(configPath));
	const rootDir = path.resolve(options.rootDir ?? findGitRoot(configDir) ?? configDir);
	return loadConfigChainInner(
		configPath,
		{
			rootDir: fs.realpathSync(rootDir),
			maxBytes: options.maxBytes ?? MAX_CONFIG_BYTES,
			visited: new Set(),
		},
		0,
	);
};

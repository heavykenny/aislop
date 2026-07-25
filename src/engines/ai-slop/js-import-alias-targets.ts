import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isRootBoundedTarget } from "../../utils/project-path-safety.js";

const MAX_NESTED_TARGET_DEPTH = 32;
const MAX_NESTED_TARGET_NODES = 1024;

const literalValue = (rawValue: string): string | null => {
	const match = /^(?:["'])([^"']+)(?:["'])$/.exec(rawValue.trim());
	return match?.[1] ?? null;
};

const literalArguments = (rawArguments: string): string[] | null => {
	const values: string[] = [];
	let remainder = rawArguments;
	const argument = /^\s*,?\s*(["'])([^"']+)\1/;
	while (remainder.trim().length > 0) {
		const match = argument.exec(remainder);
		if (!match) return null;
		values.push(match[2]);
		remainder = remainder.slice(match[0].length);
	}
	return values;
};

const resolvedPathTarget = (
	rawValue: string,
	configDirectory: string,
	rootDirectory: string,
): string | null => {
	const match = /^\s*path\.resolve\s*\(([\s\S]*)\)\s*$/.exec(rawValue);
	if (!match) return null;
	let argumentsText = match[1].trim();
	let baseDirectory = rootDirectory;
	const configBase = /^(?:__dirname|import\.meta\.dirname)\b/.exec(argumentsText);
	const cwdBase = /^process\.cwd\s*\(\s*\)/.exec(argumentsText);
	if (configBase) {
		baseDirectory = configDirectory;
		argumentsText = argumentsText.slice(configBase[0].length);
	} else if (cwdBase) {
		argumentsText = argumentsText.slice(cwdBase[0].length);
	}
	const parts = literalArguments(argumentsText);
	if (!parts || parts.length === 0) return null;
	return path.resolve(baseDirectory, ...parts);
};

export const isLocalAliasReplacement = (
	rawValue: string,
	configDirectory: string,
	rootDirectory: string,
): boolean => {
	const resolvedTarget = resolvedPathTarget(rawValue, configDirectory, rootDirectory);
	if (resolvedTarget) return isRootBoundedTarget(resolvedTarget, rootDirectory);

	const urlMatch = /new\s+URL\s*\(\s*(["'][^"']+["'])\s*,\s*import\.meta\.url\s*\)/.exec(rawValue);
	if (urlMatch) {
		const target = literalValue(urlMatch[1]);
		if (!target || (!target.startsWith("./") && !target.startsWith("../"))) return false;
		try {
			const configUrl = pathToFileURL(path.join(configDirectory, "__aislop_vite_config__.ts"));
			return isRootBoundedTarget(fileURLToPath(new URL(target, configUrl)), rootDirectory);
		} catch {
			return false;
		}
	}

	const target = literalValue(rawValue);
	if (!target) return false;
	if (
		!target.startsWith(".") &&
		!target.startsWith("/") &&
		!target.startsWith("~/") &&
		!target.startsWith("@/")
	) {
		return false;
	}
	const normalized = target.startsWith("~/") || target.startsWith("@/") ? target.slice(2) : target;
	const candidate = path.isAbsolute(normalized)
		? normalized
		: path.resolve(configDirectory, normalized);
	return isRootBoundedTarget(candidate, rootDirectory);
};

export const hasValidPackageImportTarget = (
	value: unknown,
	packageDirectory: string,
	rootDirectory: string,
): boolean => {
	if (!isRootBoundedTarget(packageDirectory, rootDirectory)) return false;
	const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
	let visitedNodes = 0;
	let hasValidTarget = false;

	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) break;
		visitedNodes++;
		if (visitedNodes > MAX_NESTED_TARGET_NODES || current.depth > MAX_NESTED_TARGET_DEPTH) {
			return false;
		}
		if (typeof current.value === "string") {
			if (current.value.startsWith("./")) {
				hasValidTarget ||= isRootBoundedTarget(
					path.resolve(packageDirectory, current.value.replaceAll("*", "__aislop__")),
					packageDirectory,
				);
				continue;
			}
			const isExternalTarget = !(
				current.value.startsWith("../") ||
				current.value.startsWith("/") ||
				current.value.startsWith("file:") ||
				(/^[a-z][a-z0-9+.-]*:/i.test(current.value) && !current.value.startsWith("node:")) ||
				current.value === "." ||
				current.value === ".."
			);
			hasValidTarget ||= isExternalTarget;
			continue;
		}
		if (!current.value || typeof current.value !== "object") continue;
		const children = Array.isArray(current.value)
			? current.value
			: Object.values(current.value as Record<string, unknown>);
		for (const child of children) {
			pending.push({ value: child, depth: current.depth + 1 });
		}
	}

	return hasValidTarget;
};

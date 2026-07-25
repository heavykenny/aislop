import fs from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { maskStringsAndComments } from "../../utils/source-masker.js";
import { readJson } from "./hallucinated-imports-manifest.js";
import type { AliasMatcher } from "./js-import-aliases.js";

export { collectDeclaredModuleMatchers } from "./js-declared-modules.js";

const isJsRelativeOrAbsolute = (spec: string): boolean =>
	spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("~/");

const RUNTIME_BUILTINS = new Set(["bun"]);
const isJsBuiltin = (spec: string): boolean => {
	if (RUNTIME_BUILTINS.has(spec)) return true;
	const stripped = spec.startsWith("node:") ? spec.slice(5) : spec;
	return isBuiltin(stripped) || isBuiltin(spec);
};

const VIRTUAL_MODULE_PREFIXES = [
	"astro:",
	"virtual:",
	"bun:",
	"file:",
	"http:",
	"https:",
	"jsr:",
	"npm:",
];
const DOCUSAURUS_VIRTUAL_PREFIXES = ["@docusaurus/", "@theme/", "@theme-original/", "@site"];

const hasDocusaurusDependency = (jsDeps: Set<string>): boolean => {
	for (const dep of jsDeps) {
		if (dep.startsWith("@docusaurus/")) return true;
	}
	return false;
};

const isDocusaurusVirtualImport = (spec: string, jsDeps: Set<string>): boolean => {
	if (!hasDocusaurusDependency(jsDeps)) return false;
	return DOCUSAURUS_VIRTUAL_PREFIXES.some((prefix) => spec === prefix || spec.startsWith(prefix));
};

const readWorkspaceGlobs = (pkg: Record<string, unknown>): string[] => {
	const globs: string[] = [];
	const ws = pkg.workspaces;
	if (Array.isArray(ws)) {
		for (const g of ws) if (typeof g === "string") globs.push(g);
	} else if (ws && typeof ws === "object") {
		const pkgs = (ws as Record<string, unknown>).packages;
		if (Array.isArray(pkgs)) {
			for (const g of pkgs) if (typeof g === "string") globs.push(g);
		}
	}
	return globs;
};

const isWaspProjectDirectory = (directory: string): boolean => {
	try {
		if (fs.existsSync(path.join(directory, "main.wasp"))) return true;
		const pkg = readJson(path.join(directory, "package.json"), directory) as Record<
			string,
			unknown
		> | null;
		if (!pkg) return false;
		return readWorkspaceGlobs(pkg).some((glob) => glob.includes("wasp") || glob.includes(".wasp"));
	} catch {
		return false;
	}
};

const isWaspSdkImport = (spec: string, filePath: string, rootDirectory: string): boolean => {
	if (spec !== "wasp" && !spec.startsWith("wasp/")) return false;
	let dir = path.dirname(filePath);
	const root = path.resolve(rootDirectory);
	while (dir.startsWith(root)) {
		if (isWaspProjectDirectory(dir)) return true;
		if (dir === root) break;
		dir = path.dirname(dir);
	}
	return false;
};

const isJsVirtualModule = (
	spec: string,
	jsDeps: Set<string>,
	declaredModuleMatchers: AliasMatcher[],
	filePath: string,
	rootDirectory: string,
): boolean => {
	if (VIRTUAL_MODULE_PREFIXES.some((prefix) => spec.startsWith(prefix))) return true;
	if (declaredModuleMatchers.some((matches) => matches(spec, filePath))) return true;
	if (spec === "bun") return true;
	if (spec === "unfonts.css" && jsDeps.has("unplugin-fonts")) return true;
	if (spec.startsWith("~icons/") && jsDeps.has("unplugin-icons")) return true;
	if (isDocusaurusVirtualImport(spec, jsDeps)) return true;
	if (isWaspSdkImport(spec, filePath, rootDirectory)) return true;
	return false;
};

const stripImportQuery = (spec: string): string => {
	const idx = spec.indexOf("?");
	return idx === -1 ? spec : spec.slice(0, idx);
};

// Filter out import-shaped substrings inside template literals or error messages — these chars never appear in real package names.
const TEMPLATE_PLACEHOLDER_RE = /\$\{/;
const isLikelyRealImportSpec = (spec: string): boolean => {
	if (spec.length === 0) return false;
	if (TEMPLATE_PLACEHOLDER_RE.test(spec)) return false;
	if (spec.includes("\\")) return false;
	if (/\s/.test(spec)) return false;
	return true;
};

const packageNameFromImport = (spec: string): string => {
	if (spec.startsWith("@")) {
		const parts = spec.split("/");
		return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
	}
	return spec.split("/")[0];
};

// The @types/* package providing types for a runtime package: `foo` -> `@types/foo`,
// `@scope/pkg` -> `@types/scope__pkg` (DefinitelyTyped scoped-name convention).
const typesPackageName = (pkg: string): string => {
	if (pkg.startsWith("@types/")) return pkg;
	if (pkg.startsWith("@")) return `@types/${pkg.slice(1).replace("/", "__")}`;
	return `@types/${pkg}`;
};

// Static `import ... from "spec"` anchored to start-of-line so it never matches
// `import { ... } from "x"` written *inside* a string literal in source.
const STATIC_IMPORT_RE = /^\s*import\s+(?:[\w*{},\s]+\s+from\s+)?["']([^"']+)["']/;
// Dynamic `import("spec")` and `require("spec")` can appear mid-line by design.
const DYNAMIC_IMPORT_RE = /\b(import|require)\s*\(\s*["']([^"']+)["']/g;

export const extractJsImports = (content: string): { spec: string; line: number }[] => {
	const lines = content.split("\n");
	const maskedLines = maskStringsAndComments(content, ".js").split("\n");
	const results: { spec: string; line: number }[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		const trimmed = line.trim();
		if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

		const staticMatch = STATIC_IMPORT_RE.exec(line);
		const staticKeywordIndex = staticMatch ? line.indexOf("import", staticMatch.index) : -1;
		if (
			staticMatch &&
			staticKeywordIndex >= 0 &&
			maskedLines[i].slice(staticKeywordIndex, staticKeywordIndex + 6) === "import" &&
			isLikelyRealImportSpec(staticMatch[1])
		) {
			results.push({ spec: staticMatch[1], line: i + 1 });
		}

		DYNAMIC_IMPORT_RE.lastIndex = 0;
		let dyn: RegExpExecArray | null = DYNAMIC_IMPORT_RE.exec(line);
		while (dyn !== null) {
			if (
				maskedLines[i].slice(dyn.index, dyn.index + dyn[1].length) === dyn[1] &&
				isLikelyRealImportSpec(dyn[2])
			) {
				results.push({ spec: dyn[2], line: i + 1 });
			}
			dyn = DYNAMIC_IMPORT_RE.exec(line);
		}
	}
	return results;
};

// Common transitive imports pulled in by unified/remark/docusaurus plugin stacks.
const JS_IMPORT_TO_DECLARATION: Record<string, string[]> = {
	"unist-util-visit": ["unified", "remark-cli", "@mdx-js/react", "@docusaurus/core"],
};

const isTransitiveJsImport = (pkg: string, jsDeps: Set<string>): boolean => {
	const declarations = JS_IMPORT_TO_DECLARATION[pkg];
	return declarations?.some((dep) => jsDeps.has(dep)) ?? false;
};

const isScopedFamilyImport = (spec: string, jsDeps: Set<string>): boolean => {
	if (!spec.startsWith("@")) return false;
	const slash = spec.indexOf("/");
	if (slash === -1) return false;
	const scope = spec.slice(0, slash);
	if (scope === "@types") return false;
	const prefix = `${scope}/`;
	for (const dep of jsDeps) {
		if (dep.startsWith(prefix)) return true;
	}
	return false;
};

export const checkJsImport = (
	rawSpec: string,
	jsDeps: Set<string>,
	tsAliasMatchers: AliasMatcher[],
	declaredModuleMatchers: AliasMatcher[],
	filePath: string,
	rootDirectory: string,
): string | null => {
	const spec = stripImportQuery(rawSpec);
	if (spec.length === 0) return null;
	if (isJsRelativeOrAbsolute(spec)) return null;
	if (isJsBuiltin(spec)) return null;
	if (isJsVirtualModule(spec, jsDeps, declaredModuleMatchers, filePath, rootDirectory)) return null;
	if (tsAliasMatchers.some((m) => m(spec, filePath))) return null;
	const pkg = packageNameFromImport(spec);
	if (pkg === "@prisma/client" && jsDeps.has("prisma")) return null;
	if (jsDeps.has(pkg)) return null;
	if (isTransitiveJsImport(pkg, jsDeps)) return null;
	if (isScopedFamilyImport(spec, jsDeps)) return null;
	// Allow @types/X if X itself is in deps (the runtime impl) — common pattern.
	if (pkg.startsWith("@types/")) {
		const realPkg = pkg.slice("@types/".length);
		if (jsDeps.has(realPkg)) return null;
	}
	// Type-only imports backed by a declared @types/* package are not hallucinated.
	if (jsDeps.has(typesPackageName(pkg))) return null;
	return pkg;
};

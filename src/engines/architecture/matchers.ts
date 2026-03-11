import fs from "node:fs";
import path from "node:path";
import { getSourceFiles } from "../../utils/source-files.js";
import type { Diagnostic, EngineContext } from "../types.js";
import type { ArchitectureRule } from "./rule-loader.js";

const minimatch = (filePath: string, pattern: string): boolean => {
	// Escape regex special chars except glob characters (* ? [ ])
	let regex = "";
	let i = 0;
	while (i < pattern.length) {
		const ch = pattern[i];
		if (ch === "*" && pattern[i + 1] === "*") {
			// ** matches any path segment (including /)
			regex += ".*";
			i += 2;
			// Skip trailing /
			if (pattern[i] === "/") i++;
		} else if (ch === "*") {
			// * matches anything except /
			regex += "[^/]*";
			i++;
		} else if (ch === "?") {
			// ? matches a single character except /
			regex += "[^/]";
			i++;
		} else if (ch === "[") {
			// Character class — pass through until ]
			const closeIndex = pattern.indexOf("]", i + 1);
			if (closeIndex === -1) {
				regex += "\\[";
				i++;
			} else {
				regex += pattern.slice(i, closeIndex + 1);
				i = closeIndex + 1;
			}
		} else if (".+^${}()|\\".includes(ch)) {
			// Escape regex special characters
			regex += `\\${ch}`;
			i++;
		} else {
			regex += ch;
			i++;
		}
	}
	return new RegExp(`^${regex}$`).test(filePath);
};

const extractImports = (content: string, ext: string): string[] => {
	const imports: string[] = [];

	if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
		// ES imports
		const esPattern = /(?:import|from)\s+["']([^"']+)["']/g;
		let match: RegExpExecArray | null;
		while ((match = esPattern.exec(content)) !== null) {
			imports.push(match[1]);
		}
		// require
		const reqPattern = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
		while ((match = reqPattern.exec(content)) !== null) {
			imports.push(match[1]);
		}
	}

	if (ext === ".py") {
		const pyPattern = /(?:from|import)\s+([\w.]+)/g;
		let match: RegExpExecArray | null;
		while ((match = pyPattern.exec(content)) !== null) {
			imports.push(match[1]);
		}
	}

	if (ext === ".go") {
		// Match imports inside import () blocks or single import "..." statements
		const goSingleImport = /^\s*import\s+"([^"]+)"/gm;
		let match: RegExpExecArray | null;
		while ((match = goSingleImport.exec(content)) !== null) {
			imports.push(match[1]);
		}
		// Multi-line import block: import ( "pkg" \n "pkg2" )
		const goMultiImport = /import\s*\(([^)]*)\)/gs;
		while ((match = goMultiImport.exec(content)) !== null) {
			const block = match[1];
			const pkgPattern = /"([^"]+)"/g;
			let pkgMatch: RegExpExecArray | null;
			while ((pkgMatch = pkgPattern.exec(block)) !== null) {
				imports.push(pkgMatch[1]);
			}
		}
	}

	return imports;
};

const applyForbidImport = (
	rule: ArchitectureRule,
	imports: string[],
	content: string,
	relativePath: string,
): Diagnostic[] => {
	if (!rule.match) return [];
	return imports
		.filter((imp) => imp.includes(rule.match!))
		.map((imp) => ({
			filePath: relativePath,
			engine: "architecture",
			rule: `arch/${rule.name}`,
			severity: rule.severity,
			message: `Forbidden import '${imp}' (rule: ${rule.name})`,
			help: `This import is not allowed by your architecture rules`,
			line: findImportLine(content, imp),
			column: 0,
			category: "Architecture",
			fixable: false,
		}));
};

const applyForbidImportFromPath = (
	rule: ArchitectureRule,
	imports: string[],
	content: string,
	relativePath: string,
): Diagnostic[] => {
	if (!rule.from || !rule.forbid) return [];
	if (!minimatch(relativePath, rule.from)) return [];
	return imports
		.filter(
			(imp) =>
				minimatch(imp, rule.forbid!) ||
				imp.includes(rule.forbid!.replace(/\*\*/g, "")),
		)
		.map((imp) => ({
			filePath: relativePath,
			engine: "architecture",
			rule: `arch/${rule.name}`,
			severity: rule.severity,
			message: `Import '${imp}' is forbidden from '${rule.from}' (rule: ${rule.name})`,
			help: `Files in '${rule.from}' cannot import from '${rule.forbid}'`,
			line: findImportLine(content, imp),
			column: 0,
			category: "Architecture",
			fixable: false,
		}));
};

const applyRequirePattern = (
	rule: ArchitectureRule,
	content: string,
	relativePath: string,
): Diagnostic[] => {
	if (!rule.where || !rule.pattern) return [];
	if (!minimatch(relativePath, rule.where)) return [];
	if (content.includes(rule.pattern)) return [];
	return [
		{
			filePath: relativePath,
			engine: "architecture",
			rule: `arch/${rule.name}`,
			severity: rule.severity,
			message: `Required pattern '${rule.pattern}' not found (rule: ${rule.name})`,
			help: `Files matching '${rule.where}' must contain '${rule.pattern}'`,
			line: 0,
			column: 0,
			category: "Architecture",
			fixable: false,
		},
	];
};

const applyRule = (
	rule: ArchitectureRule,
	imports: string[],
	content: string,
	relativePath: string,
): Diagnostic[] => {
	switch (rule.type) {
		case "forbid_import":
			return applyForbidImport(rule, imports, content, relativePath);
		case "forbid_import_from_path":
			return applyForbidImportFromPath(rule, imports, content, relativePath);
		case "require_pattern":
			return applyRequirePattern(rule, content, relativePath);
		default:
			return [];
	}
};

export const checkRules = async (
	context: EngineContext,
	rules: ArchitectureRule[],
): Promise<Diagnostic[]> => {
	const files = getSourceFiles(context);
	const diagnostics: Diagnostic[] = [];

	for (const filePath of files) {
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const relativePath = path.relative(context.rootDirectory, filePath);
		const imports = extractImports(content, path.extname(filePath));

		for (const rule of rules) {
			diagnostics.push(...applyRule(rule, imports, content, relativePath));
		}
	}

	return diagnostics;
};

const findImportLine = (content: string, importPath: string): number => {
	const lines = content.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].includes(importPath)) return i + 1;
	}
	return 0;
};

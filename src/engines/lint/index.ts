import type { Diagnostic, Engine, EngineContext, EngineResult } from "../types.js";
import { runClangTidy } from "./clang-tidy.js";
import { resolveCppLintConfig, runCppcheck } from "./cppcheck.js";
import { runDotnetLint } from "./dotnet.js";
import { runGenericLinter } from "./generic.js";
import { runGolangciLint } from "./golangci.js";
import { resolveCsharpLintConfig, runJbLint } from "./jb.js";
import { runOxlint } from "./oxlint.js";
import { runRuffLint } from "./ruff.js";

// jb reports a Roslyn finding as "jb/<id>" and roslynator as "dotnet/<id>"; when
// a project both references one of aislop's bundled analyzers AND jb runs it, the
// same finding appears twice at the same site. De-dup by (file, line, bare id),
// keeping the first pass's copy.

const bareRuleId = (rule: string): string => {
	const slash = rule.indexOf("/");
	return slash === -1 ? rule : rule.slice(slash + 1);
};

// CamelCase -> kebab: "BugproneNarrowingConversions" -> "bugprone-narrowing-conversions"
const camelToKebab = (s: string): string =>
	s
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
		.toLowerCase();

// Canonical id for cpp dedup: jb "CppClangTidyX" and clang-tidy "cat-check" collapse to the
// same key; everything else falls back to bareRuleId.
export const canonicalCppRuleId = (rule: string): string => {
	const bare = bareRuleId(rule);
	const m = /^CppClangTidy(.+)$/.exec(bare);
	return m ? camelToKebab(m[1]) : bare;
};

// Collapse duplicate findings by (file, line, canonicalized rule id). Path
// separators are normalized so Windows backslashes and Unix forward-slashes do
// not produce separate keys for the same logical file.
const dedupeDiagnostics = (
	diagnostics: Diagnostic[],
	canonicalize: (rule: string) => string,
): Diagnostic[] => {
	const seen = new Set<string>();
	const result: Diagnostic[] = [];
	for (const diagnostic of diagnostics) {
		const normalizedPath = diagnostic.filePath.replace(/\\/g, "/");
		const key = `${normalizedPath}::${diagnostic.line}::${canonicalize(diagnostic.rule)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(diagnostic);
	}
	return result;
};

/** Exported for unit tests. cppcheck and clang-tidy frequently report the same
 *  underlying defect at the same site; jb CppClangTidy* inspections normalize
 *  to the same key as aislop clang-tidy findings. */
export const dedupeCppDiagnostics = (diagnostics: Diagnostic[]): Diagnostic[] =>
	dedupeDiagnostics(diagnostics, canonicalCppRuleId);

/** Exported for unit tests. */
export const dedupeCsharpDiagnostics = (diagnostics: Diagnostic[]): Diagnostic[] =>
	dedupeDiagnostics(diagnostics, bareRuleId);

export const lintEngine: Engine = {
	name: "lint",

	async run(context: EngineContext): Promise<EngineResult> {
		const diagnostics: Diagnostic[] = [];
		const { languages, installedTools } = context;

		const promises: Promise<Diagnostic[]>[] = [];

		if (languages.includes("typescript") || languages.includes("javascript")) {
			promises.push(runOxlint(context));
			if (context.config.lint.typecheck) {
				promises.push(import("./typecheck.js").then((mod) => mod.runTypecheck(context)));
			}
		}

		if (context.frameworks.includes("expo") && context.config.lint.expoDoctor) {
			// Expo Doctor may evaluate project config, so only run it when explicitly enabled.
			promises.push(import("./expo-doctor.js").then((mod) => mod.runExpoDoctor(context)));
		}

		if (languages.includes("python") && installedTools.ruff) {
			promises.push(runRuffLint(context));
		}

		if (languages.includes("go") && installedTools["golangci-lint"]) {
			promises.push(runGolangciLint(context));
		}

		if (languages.includes("rust") && installedTools.cargo) {
			promises.push(runGenericLinter(context, "rust"));
		}

		if (languages.includes("ruby") && installedTools.rubocop) {
			promises.push(runGenericLinter(context, "ruby"));
		}

		const cpp = resolveCppLintConfig(context);
		const csharp = resolveCsharpLintConfig(context);
		const wantJbCsharp =
			languages.includes("csharp") && csharp.projectEvaluation && csharp.jb && installedTools.jb;
		const wantJbCpp = languages.includes("cpp") && cpp.jb && installedTools.jb;
		const jbPromise: Promise<Diagnostic[]> =
			wantJbCsharp || wantJbCpp
				? runJbLint(context, { includeCsharp: wantJbCsharp, includeCpp: wantJbCpp })
				: Promise.resolve([]);

		if (languages.includes("cpp")) {
			const cppPasses: Promise<Diagnostic[]>[] = [];
			if (cpp.cppcheck && installedTools.cppcheck) cppPasses.push(runCppcheck(context));
			if (cpp.clangTidy && installedTools["clang-tidy"]) cppPasses.push(runClangTidy(context));
			if (wantJbCpp)
				cppPasses.push(jbPromise.then((d) => d.filter((x) => x.category === "C++ Lint")));
			if (cppPasses.length > 0)
				promises.push(Promise.all(cppPasses).then((p) => dedupeCppDiagnostics(p.flat())));
		}

		if (languages.includes("csharp")) {
			const csharpPasses: Promise<Diagnostic[]>[] = [];
			if (csharp.projectEvaluation && csharp.roslynator && installedTools.roslynator) {
				csharpPasses.push(runDotnetLint(context));
			}
			if (wantJbCsharp)
				csharpPasses.push(jbPromise.then((d) => d.filter((x) => x.category === "C# Lint")));
			if (csharpPasses.length > 0)
				promises.push(Promise.all(csharpPasses).then((p) => dedupeCsharpDiagnostics(p.flat())));
		}

		// No linter matched the detected languages/installed tools. Report this as
		// skipped (mirroring `doctor`) rather than returning an empty result, which the
		// scan summary would otherwise launder into a misleading "done (0 issues)".
		if (promises.length === 0) {
			return {
				engine: "lint",
				diagnostics,
				elapsed: 0,
				skipped: true,
				skipReason: "no linter for the detected languages",
			};
		}

		const results = await Promise.allSettled(promises);
		for (const result of results) {
			if (result.status === "fulfilled") {
				diagnostics.push(...result.value);
			}
		}

		return {
			engine: "lint",
			diagnostics,
			elapsed: 0,
			skipped: false,
		};
	},
};

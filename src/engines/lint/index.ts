import type { Diagnostic, Engine, EngineContext, EngineResult } from "../types.js";
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

/** Exported for unit tests. */
export const dedupeCsharpDiagnostics = (diagnostics: Diagnostic[]): Diagnostic[] => {
	const seen = new Set<string>();
	const result: Diagnostic[] = [];
	for (const diagnostic of diagnostics) {
		// Normalize path separators so Windows backslashes and Unix forward-slashes
		// do not produce separate keys for the same logical file.
		const normalizedPath = diagnostic.filePath.replace(/\\/g, "/");
		const key = `${normalizedPath}::${diagnostic.line}::${bareRuleId(diagnostic.rule)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(diagnostic);
	}
	return result;
};

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

		if (languages.includes("csharp")) {
			const csharp = resolveCsharpLintConfig(context);
			const csharpPasses: Promise<Diagnostic[]>[] = [];
			if (csharp.jb && installedTools.jb) csharpPasses.push(runJbLint(context));
			if (csharp.roslynator && installedTools.roslynator) csharpPasses.push(runDotnetLint(context));
			if (csharpPasses.length > 0) {
				promises.push(
					Promise.all(csharpPasses).then((passes) => dedupeCsharpDiagnostics(passes.flat())),
				);
			}
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

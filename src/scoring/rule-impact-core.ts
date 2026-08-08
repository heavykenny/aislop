import { advisory, maintainability, mechanical, strict, style } from "./rule-impact-builders.js";
import type { RuleScoreImpact } from "./rule-impact-types.js";

export const CORE_RULE_SCORE_IMPACTS: Record<string, RuleScoreImpact> = {
	formatting: mechanical("Formatter output is mechanical cleanup.", 12),
	"import-order": mechanical("Import ordering is mechanical cleanup.", 12),
	"python-formatting": mechanical("Python formatter output is mechanical cleanup.", 12),
	"go-formatting": mechanical("Go formatter output is mechanical cleanup.", 12),
	"rust-formatting": mechanical("Rust formatter output is mechanical cleanup.", 12),
	"ruby-formatting": mechanical("Ruby formatter output is mechanical cleanup.", 12),
	"php-formatting": mechanical("PHP formatter output is mechanical cleanup.", 12),
	"csharp-formatting": mechanical("C# formatter output is mechanical cleanup.", 12),

	"code-quality/duplicate-block": maintainability(
		"Large copy-paste blocks are real maintenance debt, but repeated blocks are less severe than defects.",
	),
	"code-quality/repeated-chained-call": maintainability(
		"Repeated call chains hurt readability and change safety without usually being runtime defects.",
	),
	"code-quality/unused-declaration": mechanical(
		"Unused declarations are cleanup work and often removable, so they should not dominate the score.",
	),
	"complexity/file-too-large": style(
		"Large files are reviewability pressure, but size alone is not a confirmed defect.",
	),
	"complexity/function-too-long": style(
		"Long functions are maintainability pressure, but length alone is not a confirmed defect.",
	),
	"complexity/deep-nesting": maintainability(
		"Deep nesting makes behavior harder to reason about and is more actionable than pure size.",
	),
	"complexity/too-many-params": maintainability(
		"Large parameter lists hurt call-site safety but usually need intentional refactoring.",
	),
	"knip/files": mechanical("Unused files are cleanup work and can repeat heavily in stale repos."),
	"knip/dependencies": mechanical(
		"Unused production dependencies are cleanup and supply-chain surface, but usually mechanical.",
	),
	"knip/devDependencies": mechanical("Unused dev dependencies are low-risk cleanup."),
	"knip/unlisted": strict("A used package missing from the manifest can break installs and CI."),
	"knip/unresolved": strict("An unresolved import is a high-confidence build/runtime failure."),
	"knip/binaries": mechanical("Unused package binaries are manifest cleanup."),
	"knip/exports": mechanical(
		"Unused exports are public-surface cleanup and can be noisy in libraries.",
	),
	"knip/types": mechanical("Unused exported types are low-risk cleanup."),
	"knip/duplicates": maintainability("Duplicate exports are real API hygiene issues."),

	"security/hardcoded-secret": strict("Secret-looking source literals are high-risk."),
	"security/vulnerable-dependency": strict(
		"Known vulnerabilities deserve full impact even when remediation varies.",
	),
	"security/eval": strict("Dynamic code execution can run attacker-controlled input."),
	"security/innerhtml": strict("Raw HTML assignment can become XSS."),
	"security/dangerously-set-innerhtml": strict("React raw HTML escape hatches can become XSS."),
	"security/sql-injection": strict("Interpolated SQL can become data exfiltration or mutation."),
	"security/shell-injection": strict("Interpolated shell commands can become command execution."),
	"security/unsafe-deserialization": strict(
		"Deserializing untrusted data with a legacy .NET formatter can become remote code execution.",
	),
	"security/unsafe-c-call": strict(
		"Unbounded C string and process calls can become buffer overflows or command execution.",
	),
	"security/dependency-audit-skipped": advisory(
		"An unavailable audit is visibility loss, not evidence of a vulnerability.",
	),
	"dotnet/projects-skipped": advisory(
		"Skipping unrestored C# projects is visibility loss, not evidence of a defect.",
	),
	"cppcheck/chunks-skipped": advisory(
		"A skipped cppcheck chunk is visibility loss, not evidence that the skipped files have a defect.",
	),

	"eslint/no-undef": strict("Undefined identifiers are high-confidence runtime failures."),
	"eslint/no-unused-vars": mechanical("Unused variables are mechanical cleanup."),
	"eslint/no-unassigned-vars": strict("Variables that are never assigned point to broken logic."),
	"eslint/no-empty": style("Empty blocks can be intentional placeholders but should be reviewed."),
	"eslint/no-useless-escape": mechanical("Useless escapes are mechanical cleanup."),
	"eslint/no-unused-expressions": maintainability(
		"Unused expressions often indicate dropped logic.",
	),
	"eslint/no-shadow-restricted-names": strict(
		"Shadowing restricted names can break runtime behavior.",
	),
	"eslint/no-constant-binary-expression": strict(
		"Constant binary expressions usually indicate broken conditions.",
	),
	"eslint/no-unsafe-optional-chaining": strict("Unsafe optional chaining can throw at runtime."),
	"eslint/require-yield": maintainability("Generators without yield are API-shape mistakes."),
	"import/no-duplicates": mechanical("Duplicate import paths are mechanical cleanup."),
	"import/default": strict("Missing default exports can break module loading."),
	"import/named": strict("Missing named exports can break module loading."),
	"import/namespace": strict("Invalid namespace imports can break module loading."),
	"typescript-eslint/triple-slash-reference": mechanical(
		"Triple-slash references are usually cleanup in modern TypeScript projects.",
	),
	"unicorn/no-useless-fallback-in-spread": maintainability("Useless fallbacks add noise."),
	"unicorn/prefer-string-starts-ends-with": mechanical(
		"String predicate preferences are mechanical readability cleanup.",
	),
	"unicorn/no-invalid-remove-event-listener": strict(
		"Invalid event listener removal can leave behavior broken.",
	),
	"unicorn/no-empty-file": mechanical("Empty files are cleanup work."),
	"unicorn/no-useless-length-check": maintainability("Useless length checks add dead branches."),
	"unicorn/no-new-array": maintainability("Avoiding new Array prevents sparse-array mistakes."),
	"unicorn/no-useless-spread": maintainability("Useless spreads add noise and allocation."),
	"unicorn/no-single-promise-in-promise-methods": maintainability(
		"Single-element Promise combinators add unnecessary structure.",
	),
};

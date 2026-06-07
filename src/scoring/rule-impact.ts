export type RuleImpactTier =
	| "strict"
	| "standard"
	| "maintainability"
	| "mechanical"
	| "style"
	| "advisory";

export interface RuleScoreImpact {
	tier: RuleImpactTier;
	multiplier: number;
	cap?: number;
	rationale: string;
}

const strict = (rationale: string): RuleScoreImpact => ({
	tier: "strict",
	multiplier: 1,
	rationale,
});

const standard = (rationale: string): RuleScoreImpact => ({
	tier: "standard",
	multiplier: 1,
	rationale,
});

const maintainability = (rationale: string, cap = 24): RuleScoreImpact => ({
	tier: "maintainability",
	multiplier: 0.75,
	cap,
	rationale,
});

const mechanical = (rationale: string, cap = 16): RuleScoreImpact => ({
	tier: "mechanical",
	multiplier: 0.5,
	cap,
	rationale,
});

const style = (rationale: string, cap = 8): RuleScoreImpact => ({
	tier: "style",
	multiplier: 0.5,
	cap,
	rationale,
});

const advisory = (rationale: string, cap = 8): RuleScoreImpact => ({
	tier: "advisory",
	multiplier: 0.25,
	cap,
	rationale,
});

export const RULE_SCORE_IMPACTS: Record<string, RuleScoreImpact> = {
	formatting: mechanical("Formatter output is mechanical cleanup.", 12),
	"import-order": mechanical("Import ordering is mechanical cleanup.", 12),
	"python-formatting": mechanical("Python formatter output is mechanical cleanup.", 12),
	"go-formatting": mechanical("Go formatter output is mechanical cleanup.", 12),
	"rust-formatting": mechanical("Rust formatter output is mechanical cleanup.", 12),
	"ruby-formatting": mechanical("Ruby formatter output is mechanical cleanup.", 12),
	"php-formatting": mechanical("PHP formatter output is mechanical cleanup.", 12),

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

	"ai-slop/trivial-comment": style(
		"Restating comments are style noise; keep the finding visible but score gently.",
	),
	"ai-slop/swallowed-exception": strict(
		"Swallowed failures hide real broken states and deserve full scoring impact.",
	),
	"ai-slop/silent-recovery": strict(
		"Logging/defaulting and continuing can corrupt behavior unless handled intentionally.",
	),
	"ai-slop/meta-comment": style(
		"Process narration is cleanup noise and should not make a healthy repo look broken.",
	),
	"ai-slop/redundant-try-catch": maintainability(
		"Redundant error plumbing adds noise but is usually not a runtime defect.",
	),
	"ai-slop/redundant-type-coercion": maintainability(
		"Redundant coercion is cleanup and readability debt.",
	),
	"ai-slop/duplicate-type-declaration": maintainability(
		"Duplicate types create drift risk but usually need intentional consolidation.",
	),
	"ai-slop/thin-wrapper": maintainability(
		"Thin wrappers add abstraction debt without usually changing behavior.",
	),
	"ai-slop/generic-naming": advisory("Vague names are weak signals and often subjective."),
	"ai-slop/unused-import": mechanical("Unused imports are mechanical cleanup."),
	"ai-slop/console-leftover": style(
		"Leftover debug output is visible cleanup unless it leaks sensitive data.",
	),
	"ai-slop/todo-stub": standard("Unresolved TODO/stub markers often indicate unfinished behavior."),
	"ai-slop/unreachable-code": strict("Unreachable code is a high-confidence logic defect."),
	"ai-slop/constant-condition": strict("Constant conditions usually indicate broken branches."),
	"ai-slop/empty-function": standard(
		"Empty functions may be intentional shims, but often indicate placeholder behavior.",
	),
	"ai-slop/unsafe-type-assertion": maintainability(
		"Unsafe casts bypass type checks and can hide real data-shape bugs.",
	),
	"ai-slop/double-type-assertion": strict(
		"Double assertions deliberately force types through unknown/any and deserve strong impact.",
	),
	"ai-slop/ts-directive": style(
		"TypeScript suppressions need review, but individual directives can be intentional debt.",
	),
	"ai-slop/narrative-comment": style(
		"Narrative comments are cleanup/style findings rather than defects.",
	),
	"ai-slop/duplicate-import": mechanical("Duplicate imports are mechanical cleanup."),
	"ai-slop/hardcoded-url": advisory(
		"Hardcoded URLs are medium-confidence config signals and can be intentional canonical URLs.",
		4,
	),
	"ai-slop/hardcoded-id": advisory(
		"Hardcoded provider IDs are config signals, but not all IDs are equally risky.",
		4,
	),
	"ai-slop/python-bare-except": strict("Bare except catches system exits and hides real failures."),
	"ai-slop/python-broad-except": standard(
		"Broad exception handling is risky but sometimes intentional at boundaries.",
	),
	"ai-slop/python-mutable-default": strict(
		"Mutable defaults are a high-confidence Python behavior bug.",
	),
	"ai-slop/python-print-debug": style(
		"Debug print output is cleanup unless it leaks sensitive data.",
	),
	"ai-slop/python-range-len-loop": advisory(
		"Index loops are style/readability signals and often not harmful.",
	),
	"ai-slop/python-chained-dict-get": maintainability(
		"Chained dict fallback hides shape assumptions and deserves review.",
	),
	"ai-slop/python-repetitive-dispatch": maintainability(
		"Repetitive dispatch ladders create maintainability debt.",
	),
	"ai-slop/python-isinstance-ladder": maintainability(
		"Long isinstance ladders are brittle polymorphism but not immediate defects.",
	),
	"ai-slop/go-library-panic": maintainability(
		"Go panics in libraries deserve review, but compiler/runtime invariants and test helpers make this lower-confidence than a confirmed defect.",
	),
	"ai-slop/rust-non-test-unwrap": strict(
		"Production unwrap can panic instead of handling expected failure.",
	),
	"ai-slop/rust-todo-stub": standard(
		"Rust todo/unimplemented stubs represent unfinished behavior.",
	),
	"ai-slop/hallucinated-import": strict(
		"Imports missing from the manifest are high-confidence install/runtime failures.",
	),

	"security/hardcoded-secret": strict("Secret-looking source literals are high-risk."),
	"security/vulnerable-dependency": strict(
		"Known vulnerabilities deserve full impact even when remediation varies.",
	),
	"security/eval": strict("Dynamic code execution can run attacker-controlled input."),
	"security/innerhtml": strict("Raw HTML assignment can become XSS."),
	"security/dangerously-set-innerhtml": strict("React raw HTML escape hatches can become XSS."),
	"security/sql-injection": strict("Interpolated SQL can become data exfiltration or mutation."),
	"security/shell-injection": strict("Interpolated shell commands can become command execution."),
	"security/dependency-audit-skipped": advisory(
		"An unavailable audit is visibility loss, not evidence of a vulnerability.",
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

const DEFAULT_IMPACT: RuleScoreImpact = standard(
	"Unclassified external rule uses standard impact.",
);

const WILDCARD_RULE_SCORE_IMPACTS: Array<[prefix: string, impact: RuleScoreImpact]> = [
	["oxlint/", standard("External oxlint rule uses standard lint impact.")],
	["ruff/", standard("External ruff rule uses standard lint impact.")],
	["go/", standard("External Go lint rule uses standard lint impact.")],
	["clippy/", standard("External clippy rule uses standard lint impact.")],
	["rubocop/", standard("External rubocop rule uses standard lint impact.")],
	["typescript/", strict("TypeScript compiler diagnostics can break builds.")],
	["expo-doctor/", maintainability("Expo Doctor findings are project-configuration hygiene.")],
];

export const scoreImpactForRule = (ruleId: string): RuleScoreImpact =>
	RULE_SCORE_IMPACTS[ruleId] ??
	WILDCARD_RULE_SCORE_IMPACTS.find(([prefix]) => ruleId.startsWith(prefix))?.[1] ??
	DEFAULT_IMPACT;

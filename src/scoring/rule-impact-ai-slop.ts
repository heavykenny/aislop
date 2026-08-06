import {
	advisory,
	maintainability,
	mechanical,
	standard,
	strict,
	style,
} from "./rule-impact-builders.js";
import type { RuleScoreImpact } from "./rule-impact-types.js";

export const AI_SLOP_RULE_SCORE_IMPACTS: Record<string, RuleScoreImpact> = {
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
	"ai-slop/hidden-fallback": maintainability(
		"Safe-looking defaults that hide missing or failed state deserve explicit review.",
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
	"ai-slop/unused-css": style(
		"Dead CSS classes are cleanup, not correctness bugs, and dynamic usage can make detection lower-confidence.",
	),
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
	"ai-slop/tautological-test": standard(
		"Literal-success assertions are high-confidence test gaps but do not break production directly.",
	),

	"ai-slop/csharp-not-implemented": standard(
		"NotImplementedException stubs usually indicate unfinished behavior.",
	),
	"ai-slop/csharp-async-void": standard(
		"async void can't be awaited and its exceptions crash the process.",
	),
	"ai-slop/csharp-sync-over-async": standard(
		"Blocking on a Task with .Result/.Wait() risks deadlock and burns a thread.",
	),
	"ai-slop/csharp-suppressed-warning": maintainability(
		"Unjustified warning suppression hides analyzer findings rather than fixing them.",
	),
	"ai-slop/csharp-empty-catch-rethrow": mechanical(
		"catch (...) { throw; } is pure noise with no behavior change - mechanical cleanup.",
	),
	"ai-slop/csharp-null-forgiving": maintainability(
		"The null-forgiving ! silences nullable safety without proving the value is non-null.",
	),
	"ai-slop/csharp-console-leftover": style(
		"Leftover Console/Debug/Trace output is visible cleanup unless it leaks sensitive data.",
	),
	"ai-slop/csharp-redundant-doc-comment": style(
		"XML-doc that restates the member name is a cleanup/style finding, not a defect.",
	),
	"ai-slop/csharp-broad-catch": standard(
		"catch (Exception) buries specific failures, though it is sometimes intentional at boundaries.",
	),
	"ai-slop/csharp-linq-count": advisory(
		"Comparing .Count() to 0/1 is a readability/perf idiom signal, often harmless.",
	),
	"ai-slop/csharp-index-loop": advisory(
		"Index for-loops over .Length/.Count are style/readability signals, often not harmful.",
	),
	"ai-slop/csharp-if-ladder": maintainability(
		"Repeated if/else-if ladders dispatching on one value create maintainability debt.",
	),
	"ai-slop/csharp-string-concat-in-loop": maintainability(
		"Repeated string += in a loop is O(n^2) allocation churn; a StringBuilder is the fix.",
	),

	"ai-slop/cpp-not-implemented": standard(
		"Stubs that throw or assert 'not implemented' usually indicate unfinished behavior.",
	),
	"ai-slop/cpp-using-namespace-std-in-header": maintainability(
		"A using-directive at header scope leaks std names into every includer, a hygiene debt.",
	),
	"ai-slop/cpp-c-style-cast": style(
		"A C-style cast in C++ is a cleanup/style finding; a named cast makes intent explicit.",
	),
	"ai-slop/cpp-manual-delete": maintainability(
		"Manual delete is a memory-safety hazard; RAII/smart pointers own the resource instead.",
	),
	"ai-slop/cpp-iostream-leftover": style(
		"Leftover std::cout/std::cerr in library code is visible cleanup unless it leaks data.",
	),
	"ai-slop/cpp-null-literal": style(
		"NULL versus nullptr is a modernization/style finding; nullptr avoids integer-overload pitfalls.",
	),
	"ai-slop/cpp-define-constant": style(
		"A macro constant instead of constexpr is a style/hygiene finding, not a behavior bug.",
	),
	"ai-slop/cpp-endl-in-stream": style(
		"std::endl versus '\\n' is a minor performance/style finding from redundant flushes.",
	),
};

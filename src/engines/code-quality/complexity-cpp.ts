import { CPP_SOURCE_EXTENSIONS } from "../cpp-targets.js";

export interface FunctionPattern {
	regex: RegExp;
	langFilter: string[];
}

// C++-only function-boundary patterns, kept out of complexity.ts so that file
// stays inside its own file-too-large budget. Spread into FUNCTION_PATTERNS
// after the shared brace-language and C# patterns; the earlier indices are
// load-bearing (analyzeFunctions treats patternIndex 2 as Python).
export const CPP_FUNCTION_PATTERNS: FunctionPattern[] = [
	{
		// C++ out-of-line definitions: `Class::member(...)`, constructors
		// `Class::Class(...)`, and destructors `Class::~Class(...)`. The `::`
		// disambiguates from a plain call; a static-call statement that matches
		// is dropped by findBraceFunctionEnd's `;`-before-`{` declaration guard.
		regex: /^\s*(?:[\w:<>,*&[\]]+\s+)*?(\w+::~?\w+)\s*\(([^)]*)\)/,
		langFilter: [...CPP_SOURCE_EXTENSIONS],
	},
	{
		// Bare in-class C++ constructors/destructors (`Widget(int a) {`,
		// `~Widget() {`), which have no return type or scope to key off. The
		// negative lookahead rejects control-flow keywords, and the tail must be a
		// body `{`, a member-init list `:`, a trailing qualifier, or end-of-line -
		// so call/expression statements (`foo(a);`, `foo(a) + b`) never match.
		// Restricted to C++-only extensions so C/K&R definitions are not caught.
		regex:
			/^\s*(?:explicit\s+|constexpr\s+|inline\s+|virtual\s+)*(?!(?:if|for|while|switch|do|else|catch|return|throw|sizeof|new|delete|typeid|static_assert|decltype|case|goto)\b)(~?\w+)\s*\(([^)]*)\)\s*(?:const\b|noexcept\b|override\b|final\b|\s)*(?::|\{|$)/,
		langFilter: [".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"],
	},
];

// C++ files can't be split into separate translation units without promoting
// internal-linkage helpers to public API, so cohesive C/C++ modules
// idiomatically run long - give them the same file-size budget Rust gets.
export const CPP_FILE_LOC_MULTIPLIERS: Record<string, number> = Object.fromEntries(
	[...CPP_SOURCE_EXTENSIONS].map((extension) => [extension, 2.5]),
);

// C++ files can't be split into separate compilation units without leaking
// internal-linkage symbols across translation units. Point them at the
// component-as-translation-unit pattern instead of generic module splitting.
export const CPP_FILE_TOO_LARGE_HELP =
	"Split this C++ file into a component using the component-as-translation-unit pattern; " +
	"see docs/cpp-component-pattern.md";

import path from "node:path";
import {
	type CompiledUvGlob,
	compileUvGlob,
	type GlobMatchBudget,
	matchesUvGlob,
} from "./uv-workspace-glob.js";

const MAX_WORKSPACE_PATTERNS = 128;
const MAX_WORKSPACE_PATTERN_LENGTH = 512;
const MAX_WORKSPACE_PATTERN_CHARACTERS = 16_384;

interface CompiledComponent {
	readonly isGlob: boolean;
	readonly pattern: CompiledUvGlob;
}

type ComponentMatcher = false | CompiledComponent;
type WorkspacePathMatcher = (rootDir: string, directory: string) => boolean | null;

interface WorkspacePatternPlan {
	readonly base: string;
	readonly components: readonly ComponentMatcher[];
	readonly isGlob: boolean;
}

export const normalizeWorkspacePattern = (pattern: string): string => {
	const normalizedSeparators = path.sep === "\\" ? pattern.replaceAll("\\", "/") : pattern;
	if (!normalizedSeparators) return "";
	return path.posix.normalize(normalizedSeparators).replace(/\/$/, "");
};

export const workspacePatternsWithinBudget = (patterns: readonly string[]): boolean =>
	patterns.length <= MAX_WORKSPACE_PATTERNS &&
	patterns.reduce((total, pattern) => total + pattern.length, 0) <=
		MAX_WORKSPACE_PATTERN_CHARACTERS &&
	patterns.every((pattern) => pattern.length <= MAX_WORKSPACE_PATTERN_LENGTH);

export const relativeWorkspacePath = (rootDir: string, directory: string): string =>
	path.relative(rootDir, directory).split(path.sep).join("/");

const compileWorkspaceComponent = (component: string): ComponentMatcher | null => {
	if (component === "**") return false;
	const pattern = compileUvGlob(component);
	if (!pattern) return null;
	return {
		isGlob: pattern.isGlob,
		pattern,
	};
};

const compileWorkspacePattern = (pattern: string): WorkspacePatternPlan | null => {
	const parts = normalizeWorkspacePattern(pattern).split("/");
	const components: ComponentMatcher[] = [];
	const baseParts: string[] = [];
	let isGlob = false;
	for (const part of parts) {
		const component = compileWorkspaceComponent(part);
		if (component === null) return null;
		const componentIsGlob = component === false || component.isGlob;
		if (!isGlob && !componentIsGlob) baseParts.push(part);
		isGlob ||= componentIsGlob;
		if (component !== false || components.at(-1) !== false) components.push(component);
	}
	return { base: baseParts.join("/"), components, isGlob };
};

export const scanWorkspacePattern = (
	pattern: string,
): Pick<WorkspacePatternPlan, "base" | "isGlob"> | null => {
	const plan = compileWorkspacePattern(pattern);
	return plan && { base: plan.base, isGlob: plan.isGlob };
};

const compileWorkspacePatterns = (
	patterns: readonly string[],
): readonly WorkspacePatternPlan[] | null => {
	const plans: WorkspacePatternPlan[] = [];
	for (const pattern of patterns) {
		const plan = compileWorkspacePattern(pattern);
		if (!plan) return null;
		plans.push(plan);
	}
	return plans;
};

const candidateComponents = (rootDir: string, directory: string): string[] =>
	relativeWorkspacePath(rootDir, directory).split("/").filter(Boolean);

type PatternSearchGoal = "exact" | "descendant";

const searchPattern = (
	pattern: readonly ComponentMatcher[],
	candidate: readonly string[],
	budget: GlobMatchBudget,
	goal: PatternSearchGoal,
): boolean | null => {
	const visited = new Set<number>();
	let exhausted = false;
	const search = (patternIndex: number, candidateIndex: number): boolean => {
		if (budget.remainingSteps <= 0) {
			exhausted = true;
			return false;
		}
		budget.remainingSteps -= 1;
		const key = patternIndex * (candidate.length + 1) + candidateIndex;
		if (visited.has(key)) return false;
		visited.add(key);
		if (goal === "exact" && patternIndex === pattern.length) {
			return candidateIndex === candidate.length;
		}
		if (goal === "descendant" && candidateIndex === candidate.length) {
			return patternIndex < pattern.length;
		}
		const matcher = pattern[patternIndex];
		if (matcher === undefined) return false;
		if (matcher === false) {
			if (goal === "exact" && patternIndex === pattern.length - 1) {
				return candidateIndex < candidate.length;
			}
			return (
				search(patternIndex + 1, candidateIndex) ||
				(candidateIndex < candidate.length && search(patternIndex, candidateIndex + 1))
			);
		}
		if (candidateIndex >= candidate.length) return false;
		const matches = matchesUvGlob(matcher.pattern, candidate[candidateIndex], true, budget);
		if (matches === null) {
			exhausted = true;
			return false;
		}
		return matches && search(patternIndex + 1, candidateIndex + 1);
	};
	const matched = search(0, 0);
	return exhausted ? null : matched;
};

const matchAnyPattern = (
	plans: readonly WorkspacePatternPlan[],
	candidate: readonly string[],
	budget: GlobMatchBudget,
	goal: PatternSearchGoal,
): boolean | null => {
	for (const plan of plans) {
		const matched = searchPattern(plan.components, candidate, budget, goal);
		if (matched === null || matched) return matched;
	}
	return false;
};

export const createWorkspacePathMatcher = (
	patterns: readonly string[],
	matchSeparators: boolean,
	budget: GlobMatchBudget,
): WorkspacePathMatcher | null => {
	if (!workspacePatternsWithinBudget(patterns)) return null;
	if (matchSeparators) {
		const compiled = patterns.map((pattern) => compileUvGlob(normalizeWorkspacePattern(pattern)));
		if (compiled.some((pattern) => pattern === null)) return null;
		return (rootDir, directory) => {
			const candidate = relativeWorkspacePath(rootDir, directory);
			for (const pattern of compiled) {
				if (!pattern) continue;
				const matched = matchesUvGlob(pattern, candidate, false, budget);
				if (matched === null || matched) return matched;
			}
			return false;
		};
	}
	const plans = compileWorkspacePatterns(patterns);
	if (!plans) return null;
	return (rootDir, directory) => {
		const candidate = candidateComponents(rootDir, directory);
		return matchAnyPattern(plans, candidate, budget, "exact");
	};
};

export const createWorkspaceDescendantMatcher = (
	patterns: readonly string[],
	budget: GlobMatchBudget,
): WorkspacePathMatcher | null => {
	if (!workspacePatternsWithinBudget(patterns)) return null;
	const plans = compileWorkspacePatterns(patterns);
	if (!plans) return null;
	return (rootDir, directory) => {
		const candidate = candidateComponents(rootDir, directory);
		return matchAnyPattern(plans, candidate, budget, "descendant");
	};
};

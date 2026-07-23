type CharacterRange = readonly [start: number, end: number];

type GlobToken =
	| { readonly kind: "literal"; readonly value: string }
	| { readonly kind: "any-character" | "any-sequence" | "recursive-sequence" }
	| {
			readonly kind: "character-class";
			readonly negated: boolean;
			readonly ranges: readonly CharacterRange[];
	  };

export interface CompiledUvGlob {
	readonly isGlob: boolean;
	readonly tokens: readonly GlobToken[];
}

export interface GlobMatchBudget {
	remainingSteps: number;
}

const consumeMatchStep = (budget: GlobMatchBudget): boolean => {
	if (budget.remainingSteps <= 0) return false;
	budget.remainingSteps -= 1;
	return true;
};

const readCharacterClass = (
	characters: readonly string[],
	start: number,
): { next: number; token: GlobToken } | null => {
	const negated = characters[start + 1] === "!";
	const contentStart = start + (negated ? 2 : 1);
	let close = contentStart + 1;
	while (close < characters.length && characters[close] !== "]") close += 1;
	if (close === characters.length) return null;
	const ranges: CharacterRange[] = [];
	for (let index = contentStart; index < close; index += 1) {
		const first = characters[index].codePointAt(0);
		if (first === undefined) return null;
		if (index + 2 < close && characters[index + 1] === "-") {
			const last = characters[index + 2].codePointAt(0);
			if (last === undefined) return null;
			ranges.push([first, last]);
			index += 2;
		} else {
			ranges.push([first, first]);
		}
	}
	return { next: close + 1, token: { kind: "character-class", negated, ranges } };
};

export const compileUvGlob = (pattern: string): CompiledUvGlob | null => {
	const characters = Array.from(pattern);
	const tokens: GlobToken[] = [];
	let isGlob = false;
	for (let index = 0; index < characters.length; ) {
		const character = characters[index];
		if (character === "?") {
			tokens.push({ kind: "any-character" });
			isGlob = true;
			index += 1;
		} else if (character === "*") {
			const recursive = characters[index + 1] === "*";
			if (recursive) {
				const beginsComponent = index === 0 || characters[index - 1] === "/";
				const after = characters[index + 2];
				if (!beginsComponent || (after !== undefined && after !== "/")) return null;
				if (tokens.at(-1)?.kind !== "recursive-sequence") {
					tokens.push({ kind: "recursive-sequence" });
				}
				index += after === "/" ? 3 : 2;
			} else {
				tokens.push({ kind: "any-sequence" });
				index += 1;
			}
			isGlob = true;
		} else if (character === "[") {
			const characterClass = readCharacterClass(characters, index);
			if (!characterClass) return null;
			tokens.push(characterClass.token);
			isGlob = true;
			index = characterClass.next;
		} else {
			tokens.push({ kind: "literal", value: character });
			index += 1;
		}
	}
	return { isGlob, tokens };
};

const characterClassMatches = (
	token: Extract<GlobToken, { kind: "character-class" }>,
	value: string,
) => {
	const codePoint = value.codePointAt(0);
	if (codePoint === undefined) return false;
	const included = token.ranges.some(([start, end]) => codePoint >= start && codePoint <= end);
	return token.negated ? !included : included;
};

const closeEmptySequences = (
	tokens: readonly GlobToken[],
	states: ReadonlySet<number>,
	followsSeparator: boolean,
	budget: GlobMatchBudget,
): Set<number> | null => {
	const closed = new Set(states);
	for (const index of closed) {
		if (!consumeMatchStep(budget)) return null;
		const token = tokens[index];
		if (
			token?.kind === "any-sequence" ||
			(token?.kind === "recursive-sequence" && followsSeparator)
		) {
			closed.add(index + 1);
		}
	}
	return closed;
};

export const matchesUvGlob = (
	pattern: CompiledUvGlob,
	candidate: string,
	requireLiteralSeparator: boolean,
	budget: GlobMatchBudget,
): boolean | null => {
	let states = closeEmptySequences(pattern.tokens, new Set([0]), true, budget);
	if (!states) return null;
	for (const character of candidate) {
		const next = new Set<number>();
		for (const index of states) {
			if (!consumeMatchStep(budget)) return null;
			const token = pattern.tokens[index];
			const separatorBlocked = requireLiteralSeparator && character === "/";
			if (token?.kind === "literal" && token.value === character) next.add(index + 1);
			else if (token?.kind === "any-character" && !separatorBlocked) next.add(index + 1);
			else if (token?.kind === "character-class" && !separatorBlocked) {
				if (characterClassMatches(token, character)) next.add(index + 1);
			} else if (token?.kind === "any-sequence" && !separatorBlocked) next.add(index);
			else if (token?.kind === "recursive-sequence") next.add(index);
		}
		states = closeEmptySequences(pattern.tokens, next, character === "/", budget);
		if (!states) return null;
		if (states.size === 0) return false;
	}
	if (states.has(pattern.tokens.length)) return true;
	return [...states].some(
		(index) =>
			index === pattern.tokens.length - 1 && pattern.tokens[index]?.kind === "recursive-sequence",
	);
};

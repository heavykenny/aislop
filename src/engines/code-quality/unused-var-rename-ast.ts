// aislop-ignore-file duplicate-block
import ts from "typescript";

/**
 * The code location of an unused identifier falls into one of these shapes.
 * Each shape has a different safe rewrite to mark it "intentionally unused".
 */
type BindingShape =
	| { kind: "positionalParameter"; identifier: ts.Identifier }
	| { kind: "shorthandDestructure"; identifier: ts.Identifier }
	| { kind: "aliasedDestructure"; identifier: ts.Identifier }
	| { kind: "restElement"; identifier: ts.Identifier }
	| { kind: "catchParameter"; identifier: ts.Identifier }
	| { kind: "arrayBindingElement"; identifier: ts.Identifier }
	| { kind: "variableDeclaration"; identifier: ts.Identifier }
	| { kind: "unsupported"; reason: string };

export interface PendingEdit {
	start: number;
	end: number;
	replacement: string;
}

const getLineOfIdentifier = (sourceFile: ts.SourceFile, node: ts.Node): number =>
	sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

/**
 * Walk the AST and collect every Identifier whose text matches `name` and
 * whose line is within ±1 of `targetLine`.
 */
export const findCandidateIdentifiers = (
	sourceFile: ts.SourceFile,
	name: string,
	targetLine: number,
): ts.Identifier[] => {
	const matches: ts.Identifier[] = [];
	const visit = (n: ts.Node): void => {
		if (ts.isIdentifier(n) && n.text === name) {
			const line = getLineOfIdentifier(sourceFile, n);
			if (Math.abs(line - targetLine) <= 1) {
				matches.push(n);
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(sourceFile);
	return matches;
};

const classifyBindingElement = (
	identifier: ts.Identifier,
	bindingElement: ts.BindingElement,
): BindingShape => {
	const pattern = bindingElement.parent;

	// Rest element: `...foo` (works for both object and array patterns)
	if (bindingElement.dotDotDotToken !== undefined && bindingElement.name === identifier) {
		return { kind: "restElement", identifier };
	}

	if (ts.isObjectBindingPattern(pattern)) {
		// Aliased destructure: `{ propertyName: localName }` where identifier is local name
		if (bindingElement.propertyName !== undefined && bindingElement.name === identifier) {
			return { kind: "aliasedDestructure", identifier };
		}
		// Shorthand destructure: `{ foo }` — propertyName is undefined
		if (bindingElement.propertyName === undefined && bindingElement.name === identifier) {
			return { kind: "shorthandDestructure", identifier };
		}
	}

	// Array binding: `const [x] = …` — rename in place
	if (ts.isArrayBindingPattern(pattern) && bindingElement.name === identifier) {
		return { kind: "arrayBindingElement", identifier };
	}

	return { kind: "unsupported", reason: "binding element context not supported" };
};

export const classifyIdentifier = (identifier: ts.Identifier): BindingShape => {
	const parent = identifier.parent;

	if (ts.isParameter(parent) && parent.name === identifier) {
		return { kind: "positionalParameter", identifier };
	}

	if (ts.isBindingElement(parent)) {
		return classifyBindingElement(identifier, parent);
	}

	// Catch clause: `catch (e)` — variableDeclaration.name is the identifier.
	if (
		ts.isVariableDeclaration(parent) &&
		parent.parent &&
		ts.isCatchClause(parent.parent) &&
		parent.name === identifier
	) {
		return { kind: "catchParameter", identifier };
	}

	if (ts.isVariableDeclaration(parent) && parent.name === identifier) {
		return { kind: "variableDeclaration", identifier };
	}

	return { kind: "unsupported", reason: "identifier context not supported" };
};

const renameIdentifierInPlace = (
	sourceFile: ts.SourceFile,
	identifier: ts.Identifier,
): { edit: PendingEdit | null; skipReason?: string } => {
	const name = identifier.text;
	if (name.startsWith("_")) return { edit: null, skipReason: "already prefixed" };
	return {
		edit: {
			start: identifier.getStart(sourceFile),
			end: identifier.getEnd(),
			replacement: `_${name}`,
		},
	};
};

const shorthandToAliased = (
	sourceFile: ts.SourceFile,
	identifier: ts.Identifier,
): { edit: PendingEdit | null; skipReason?: string } => {
	const name = identifier.text;
	if (name.startsWith("_")) return { edit: null, skipReason: "already prefixed" };
	return {
		edit: {
			start: identifier.getStart(sourceFile),
			end: identifier.getEnd(),
			replacement: `${name}: _${name}`,
		},
	};
};

export const computeEdit = (
	sourceFile: ts.SourceFile,
	shape: BindingShape,
): { edit: PendingEdit | null; skipReason?: string } => {
	switch (shape.kind) {
		case "unsupported":
			return { edit: null, skipReason: shape.reason };
		case "positionalParameter":
		case "catchParameter":
		case "restElement":
		case "arrayBindingElement":
			return renameIdentifierInPlace(sourceFile, shape.identifier);
		case "shorthandDestructure":
			return shorthandToAliased(sourceFile, shape.identifier);
		case "aliasedDestructure":
			return renameIdentifierInPlace(sourceFile, shape.identifier);
		case "variableDeclaration":
			return {
				edit: null,
				skipReason: "unused variable binding outside parameter/destructure",
			};
	}
};

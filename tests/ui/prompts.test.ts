import { describe, expect, it, vi } from "vitest";

// Clack's cancel sentinel is a module-private `Symbol("clack:cancel")`
// (see node_modules/@clack/core/dist/index.mjs — `C=Symbol("clack:cancel")`),
// not a `Symbol.for(...)` registered symbol, so we can't materialize an equal
// sentinel from outside the library. Stub `isCancel` with a shared sentinel
// so we can exercise the cancel branch of `runCancellable`.
const stubCancelSymbol = Symbol("clack:cancel");
vi.mock("@clack/prompts", async () => {
	const actual = await vi.importActual<typeof import("@clack/prompts")>("@clack/prompts");
	return {
		...actual,
		isCancel: (value: unknown): value is symbol => value === stubCancelSymbol,
	};
});

const prompts = await import("../../src/ui/prompts.js");

describe("prompts", () => {
	it("re-exports the clack primitives we depend on", () => {
		expect(typeof prompts.select).toBe("function");
		expect(typeof prompts.confirm).toBe("function");
		expect(typeof prompts.text).toBe("function");
		expect(typeof prompts.multiselect).toBe("function");
		expect(typeof prompts.intro).toBe("function");
		expect(typeof prompts.outro).toBe("function");
		expect(typeof prompts.isCancel).toBe("function");
		expect(typeof prompts.cancel).toBe("function");
	});

	it("runCancellable returns undefined when clack cancel symbol is returned", async () => {
		const result = await prompts.runCancellable(async () => stubCancelSymbol);
		expect(result).toBeUndefined();
	});

	it("runCancellable passes the value through when not cancelled", async () => {
		const result = await prompts.runCancellable(async () => "hello");
		expect(result).toBe("hello");
	});
});

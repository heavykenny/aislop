import { describe, expect, it } from "vitest";
import {
	moveInteractiveSelection,
	parseInteractiveActionInput,
} from "../src/commands/interactive.js";

describe("interactive action parsing", () => {
	it("accepts numeric shortcuts", () => {
		expect(parseInteractiveActionInput("1")).toBe("scan");
		expect(parseInteractiveActionInput("2")).toBe("fix");
		expect(parseInteractiveActionInput("3")).toBe("init");
		expect(parseInteractiveActionInput("4")).toBe("doctor");
		expect(parseInteractiveActionInput("5")).toBe("rules");
	});

	it("accepts q and full command names", () => {
		expect(parseInteractiveActionInput("q")).toBe("quit");
		expect(parseInteractiveActionInput("Q")).toBe("quit");
		expect(parseInteractiveActionInput("scan")).toBe("scan");
		expect(parseInteractiveActionInput("fix")).toBe("fix");
		expect(parseInteractiveActionInput("doctor")).toBe("doctor");
	});

	it("rejects unknown input", () => {
		expect(parseInteractiveActionInput("0")).toBeNull();
		expect(parseInteractiveActionInput("next")).toBeNull();
	});

	it("wraps selection for arrow navigation", () => {
		expect(moveInteractiveSelection(0, -1)).toBe(5);
		expect(moveInteractiveSelection(5, 1)).toBe(0);
		expect(moveInteractiveSelection(2, 1)).toBe(3);
	});
});

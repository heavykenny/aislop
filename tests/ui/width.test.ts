import { describe, expect, it } from "vitest";
import { padEnd, padStart, stringWidth, truncate } from "../../src/ui/width.js";

describe("width", () => {
	it("measures plain ASCII as one column per character", () => {
		expect(stringWidth("aislop")).toBe(6);
	});

	it("strips ANSI before measuring", () => {
		expect(stringWidth("\x1B[38;2;34;197;94mhi\x1B[39m")).toBe(2);
	});

	it("counts CJK as width 2", () => {
		expect(stringWidth("中文")).toBe(4);
	});

	it("pads end using visual width", () => {
		expect(padEnd("hi", 5)).toBe("hi   ");
		expect(padEnd("\x1B[31mhi\x1B[39m", 5)).toBe("\x1B[31mhi\x1B[39m   ");
	});

	it("pads start using visual width", () => {
		expect(padStart("hi", 5)).toBe("   hi");
	});

	it("does not pad when already at or beyond target", () => {
		expect(padEnd("abcdef", 3)).toBe("abcdef");
	});

	it("truncates with ellipsis when over max", () => {
		expect(truncate("abcdefgh", 5)).toBe("abcd…");
	});

	it("returns input unchanged when within max", () => {
		expect(truncate("abc", 5)).toBe("abc");
	});
});

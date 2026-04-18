import { describe, expect, it } from "vitest";
import { createSymbols } from "../../src/ui/symbols.js";

describe("symbols", () => {
	it("returns unicode glyphs in TTY mode", () => {
		const s = createSymbols({ plain: false });
		expect(s.stepActive).toBe("◇");
		expect(s.stepDone).toBe("◆");
		expect(s.rail).toBe("│");
		expect(s.railEnd).toBe("└");
		expect(s.pass).toBe("✓");
		expect(s.fail).toBe("✗");
		expect(s.warn).toBe("!");
		expect(s.hint).toBe("→");
		expect(s.engineActive).toBe("⏵");
		expect(s.neutral).toBe("─");
	});

	it("returns ASCII fallbacks in plain mode", () => {
		const s = createSymbols({ plain: true });
		expect(s.stepActive).toBe("*");
		expect(s.stepDone).toBe("*");
		expect(s.rail).toBe("|");
		expect(s.railEnd).toBe("+");
		expect(s.pass).toBe("[ok]");
		expect(s.fail).toBe("[x]");
		expect(s.warn).toBe("[!]");
		expect(s.hint).toBe("->");
		expect(s.engineActive).toBe(">");
		expect(s.neutral).toBe("-");
	});
});

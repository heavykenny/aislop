import { describe, expect, it } from "vitest";
import { renderBadgeOutput } from "../../src/commands/badge.js";

describe("renderBadgeOutput", () => {
	it("emits the markdown snippet pointing at badges.scanaislop.com and the project page", () => {
		const out = renderBadgeOutput({
			owner: "scanaislop",
			repo: "aislop",
			svgUrl: "https://badges.scanaislop.com/score/scanaislop/aislop.svg",
			pageUrl: "https://scanaislop.com/scanaislop/aislop",
		});

		expect(out).toContain("scanaislop/aislop");
		expect(out).toContain(
			"https://badges.scanaislop.com/score/scanaislop/aislop.svg",
		);
		expect(out).toContain(
			"[![aislop](https://badges.scanaislop.com/score/scanaislop/aislop.svg)](https://scanaislop.com/scanaislop/aislop)",
		);
	});

	it("renders consistently for any owner/repo pair", () => {
		const out = renderBadgeOutput({
			owner: "vercel",
			repo: "next.js",
			svgUrl: "https://badges.scanaislop.com/score/vercel/next.js.svg",
			pageUrl: "https://scanaislop.com/vercel/next.js",
		});

		expect(out).toContain("vercel/next.js");
		expect(out).toContain(
			"[![aislop](https://badges.scanaislop.com/score/vercel/next.js.svg)](https://scanaislop.com/vercel/next.js)",
		);
	});
});

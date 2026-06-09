import { describe, expect, it } from "vitest";
import { renderBadgeOutput } from "../../src/commands/badge.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

describe("renderBadgeOutput", () => {
	it("emits the markdown snippet pointing at badges.scanaislop.com and the project page", () => {
		const out = strip(
			renderBadgeOutput({
				owner: "scanaislop",
				repo: "aislop",
				svgUrl: "https://badges.scanaislop.com/score/scanaislop/aislop.svg",
				pageUrl: "https://scanaislop.com/scanaislop/aislop",
			}),
		);

		expect(out).toContain("Badge");
		expect(out).toMatch(/Repository\s+scanaislop\/aislop/);
		expect(out).toMatch(
			/Badge URL\s+https:\/\/badges\.scanaislop\.com\/score\/scanaislop\/aislop\.svg/,
		);
		expect(out).toMatch(/Page\s+https:\/\/scanaislop\.com\/scanaislop\/aislop/);
		expect(out).toContain("Markdown");
		expect(out).toMatch(/README\s+\[!\[aislop\]/);
		expect(out).toContain("Next");
		expect(out).toContain("https://badges.scanaislop.com/score/scanaislop/aislop.svg");
		expect(out).toContain(
			"[![aislop](https://badges.scanaislop.com/score/scanaislop/aislop.svg)](https://scanaislop.com/scanaislop/aislop)",
		);
		expect(out).toMatch(/Add\s+put the README markdown near your project title/);
		expect(out).toMatch(/Refresh\s+run a public scan to update the score behind the badge/);
	});

	it("renders consistently for any owner/repo pair", () => {
		const out = strip(
			renderBadgeOutput({
				owner: "vercel",
				repo: "next.js",
				svgUrl: "https://badges.scanaislop.com/score/vercel/next.js.svg",
				pageUrl: "https://scanaislop.com/vercel/next.js",
			}),
		);

		expect(out).toMatch(/Repository\s+vercel\/next\.js/);
		expect(out).toContain(
			"[![aislop](https://badges.scanaislop.com/score/vercel/next.js.svg)](https://scanaislop.com/vercel/next.js)",
		);
	});
});

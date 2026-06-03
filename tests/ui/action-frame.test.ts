import { describe, expect, it } from "vitest";
import { renderActionEnd, renderActionStart } from "../../src/ui/action-frame.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

describe("action frame", () => {
	it("renders a visible start and completion boundary", () => {
		const out = strip(
			`${renderActionStart({ label: "Scan", hint: "Score project" })}body${renderActionEnd({
				label: "Scan",
			})}`,
		);

		expect(out).toContain("┌ Scan · Score project");
		expect(out).toContain("body");
		expect(out).toContain("└ Scan complete");
	});

	it("can render skipped actions", () => {
		const out = strip(renderActionEnd({ label: "Install hooks", status: "skipped" }));

		expect(out).toContain("└ Install hooks skipped");
	});
});

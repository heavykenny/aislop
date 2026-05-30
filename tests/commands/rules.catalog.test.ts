import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogRuleIds } from "../../src/commands/rules.js";

const ENGINES_DIR = fileURLToPath(new URL("../../src/engines", import.meta.url));
const RULE_ID_RE = /["'`]((?:ai-slop|complexity|security|code-quality|knip)\/[a-z0-9-]+)["'`]/g;

const walk = (dir: string): string[] => {
	const out: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.name.endsWith(".ts")) out.push(full);
	}
	return out;
};

const emittedRuleIds = (): Set<string> => {
	const ids = new Set<string>();
	for (const file of walk(ENGINES_DIR)) {
		const source = fs.readFileSync(file, "utf-8");
		for (const match of source.matchAll(RULE_ID_RE)) ids.add(match[1]);
	}
	return ids;
};

describe("rules catalog completeness", () => {
	it("lists every native rule the engines emit (no silent drift)", () => {
		const catalog = new Set(catalogRuleIds());
		const missing = [...emittedRuleIds()].filter((id) => !catalog.has(id)).sort();
		expect(missing, `rule(s) emitted by an engine but absent from aislop rules: ${missing.join(", ")}`).toEqual(
			[],
		);
	});
});

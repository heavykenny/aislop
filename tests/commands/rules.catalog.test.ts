import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogRuleIds } from "../../src/commands/rules.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ENGINES_DIR = fileURLToPath(new URL("../../src/engines", import.meta.url));
const DOCS_RULES_PATH = path.join(REPO_ROOT, "docs/rules.md");
const RULE_LABELS_PATH = path.join(REPO_ROOT, "src/output/rule-labels.ts");
const RULE_ID_RE = /["'`]((?:ai-slop|complexity|security|code-quality|knip)\/[a-zA-Z0-9-]+)["'`]/g;
const DOC_RULE_ID_RE = /`((?:ai-slop|complexity|security|code-quality|knip)\/[a-zA-Z0-9-]+)`/g;

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

const ruleLabelsIds = (): Set<string> => {
	const source = fs.readFileSync(RULE_LABELS_PATH, "utf-8");
	return new Set([...source.matchAll(RULE_ID_RE)].map((match) => match[1]));
};

const documentedRuleIds = (): Set<string> => {
	const source = fs.readFileSync(DOCS_RULES_PATH, "utf-8");
	return new Set([...source.matchAll(DOC_RULE_ID_RE)].map((match) => match[1]));
};

describe("rules catalog completeness", () => {
	it("lists every native rule the engines emit (no silent drift)", () => {
		const catalog = new Set(catalogRuleIds());
		const missing = [...emittedRuleIds()].filter((id) => !catalog.has(id)).sort();
		expect(
			missing,
			`rule(s) emitted by an engine but absent from aislop rules: ${missing.join(", ")}`,
		).toEqual([]);
	});

	it("has an explicit output label for every cataloged native rule", () => {
		const labels = ruleLabelsIds();
		const missing = catalogRuleIds()
			.filter((id) => !labels.has(id))
			.sort();
		expect(
			missing,
			`rule label(s) missing from src/output/rule-labels.ts: ${missing.join(", ")}`,
		).toEqual([]);
	});

	it("documents every cataloged native rule in docs/rules.md", () => {
		const docs = documentedRuleIds();
		const missing = catalogRuleIds()
			.filter((id) => !docs.has(id))
			.sort();
		expect(missing, `rule(s) missing from docs/rules.md: ${missing.join(", ")}`).toEqual([]);
	});
});

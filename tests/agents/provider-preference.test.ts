import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	agentProviderPreferencePath,
	clearAgentProviderPreference,
	readAgentProviderPreference,
	resolveAgentProviderSelection,
	writeAgentProviderPreference,
} from "../../src/agents/provider-preference.js";

let tempDirs: string[] = [];

const tempRoot = (): string => {
	const root = mkdtempSync(path.join(tmpdir(), "aislop-provider-preference-"));
	tempDirs.push(root);
	return root;
};

describe("agent provider preference", () => {
	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs = [];
	});

	it("stores and clears a repo-local default provider", () => {
		const root = tempRoot();

		writeAgentProviderPreference(root, "claude", new Date("2026-06-07T10:00:00.000Z"));

		expect(readAgentProviderPreference(root)).toEqual({
			provider: "claude",
			updatedAt: "2026-06-07T10:00:00.000Z",
		});
		expect(clearAgentProviderPreference(root)).toBe(true);
		expect(readAgentProviderPreference(root)).toBeNull();
	});

	it("ignores invalid preference files instead of failing provider resolution", () => {
		const root = tempRoot();
		const file = agentProviderPreferencePath(root);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, "{ invalid json", "utf-8");

		expect(readAgentProviderPreference(root)).toBeNull();
		expect(
			resolveAgentProviderSelection({
				root,
				requested: "auto",
				explicit: false,
			}),
		).toMatchObject({ selection: "auto", source: "auto" });
	});

	it("uses the saved preference only when the provider flag was not explicit", () => {
		const root = tempRoot();
		writeAgentProviderPreference(root, "opencode", new Date("2026-06-07T10:00:00.000Z"));

		expect(
			resolveAgentProviderSelection({
				root,
				requested: "auto",
				explicit: false,
			}),
		).toMatchObject({ selection: "opencode", source: "preference" });
		expect(
			resolveAgentProviderSelection({
				root,
				requested: "codex",
				explicit: true,
			}),
		).toMatchObject({ selection: "codex", source: "cli" });
	});
});

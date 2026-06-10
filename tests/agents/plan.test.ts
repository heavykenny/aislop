import { describe, expect, it } from "vitest";
import { PROVIDERS, type ProviderStatus } from "../../src/agents/providers.js";
import { buildAgentPlanBlockers, renderAgentPlan } from "../../src/commands/agent-plan.js";
import type { AgentOptions, AgentScanJson } from "../../src/commands/agent-types.js";
import type { Diagnostic } from "../../src/engines/types.js";
import { stripAnsi as strip } from "../helpers/ansi.js";

const options = (overrides: Partial<AgentOptions> = {}): AgentOptions => ({
	provider: "codex",
	providerSource: "cli",
	targetScore: 90,
	maxTurns: 4,
	limit: 8,
	inPlace: false,
	keepWorktree: true,
	apply: false,
	yes: false,
	dryRun: false,
	background: false,
	noFix: false,
	cleanup: false,
	commit: false,
	pr: false,
	commitMessage: "chore(aislop): repair AI slop findings",
	ready: false,
	...overrides,
});

const providerStatus = (overrides: Partial<ProviderStatus> = {}): ProviderStatus => ({
	provider: PROVIDERS[0],
	installed: true,
	authenticated: null,
	version: "codex-cli 1.0.0",
	authHint: null,
	...overrides,
});

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
	filePath: "src/a.ts",
	engine: "ai-slop",
	rule: "ai-slop/example",
	severity: "warning",
	message: "Example",
	help: "Fix it",
	line: 7,
	column: 1,
	category: "AI Slop",
	fixable: false,
	...overrides,
});

const scan = (diagnostics: Diagnostic[] = [diagnostic()]): AgentScanJson => ({
	score: 72,
	label: "Degraded",
	diagnostics,
	summary: {
		errors: 0,
		warnings: diagnostics.length,
		fixable: 0,
		files: 1,
	},
});

describe("agent plan", () => {
	it("renders provider, worktree, finding, and publish preview", () => {
		const out = strip(
			renderAgentPlan({
				directory: "/repo",
				git: { root: "/repo", branch: "main", head: "abc123", dirty: false },
				provider: providerStatus(),
				scan: scan(),
				findings: [diagnostic()],
				blockers: [],
				options: options({
					apply: true,
					pr: true,
					commit: true,
					branch: "aislop/agent",
					base: "main",
					prTitle: "Repair AI slop",
				}),
			}),
		);

		expect(out).toContain("Agent plan");
		expect(out).toMatch(/Provider\s+Codex/);
		expect(out).toMatch(/Source\s+--provider flag/);
		expect(out).toMatch(/Worktree\s+create isolated git worktree/);
		expect(out).toMatch(/Provider\s+run Codex with 1 finding/);
		expect(out).toMatch(/Publish\s+commit, push, and open draft PR/);
		expect(out).toMatch(/Commit message\s+chore\(aislop\): repair AI slop findings/);
		expect(out).toContain("src/a.ts:7 ai-slop/example");
		expect(out).toContain("No blockers found");
	});

	it("renders a saved provider preference as the provider source", () => {
		const out = strip(
			renderAgentPlan({
				directory: "/repo",
				git: { root: "/repo", branch: "main", head: "abc123", dirty: false },
				provider: providerStatus(),
				scan: scan([]),
				findings: [],
				blockers: [],
				options: options({
					providerSource: "preference",
					providerPreference: "codex",
				}),
			}),
		);

		expect(out).toMatch(/Source\s+saved local default \(codex\)/);
	});

	it("reports blockers for dirty isolated worktrees and noninteractive background apply", () => {
		const blockers = buildAgentPlanBlockers({
			git: { root: "/repo", branch: "main", head: "abc123", dirty: true },
			provider: providerStatus({ authenticated: false }),
			options: options({ background: true, apply: true }),
		});

		expect(blockers).toContain("Codex is installed but not authenticated.");
		expect(blockers).toContain(
			"Isolated worktree mode needs a clean checkout. Commit/stash changes or use --in-place.",
		);
		expect(blockers).toContain("Background apply cannot prompt. Use --apply --yes.");
	});
});

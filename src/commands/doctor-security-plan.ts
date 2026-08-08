import fs from "node:fs";
import path from "node:path";
import type { Language } from "../utils/discover.js";
import type { PlanContext, ToolDecision } from "./doctor-plan.js";
import { projectEvaluationGate } from "./doctor-trust-plan.js";

interface SystemToolSpec {
	binary: string;
	toolLabel: string;
	remediation: string;
	requiresBinaries?: string[];
}

interface AuditSpec {
	files: string[];
	languages?: Language[];
	bundled?: string;
	systemTool?: SystemToolSpec;
}

const AUDIT_SPECS: AuditSpec[] = [
	{ files: ["pnpm-lock.yaml"], bundled: "pnpm audit" },
	{ files: ["bun.lock", "bun.lockb"], bundled: "bun audit" },
	{ files: ["package-lock.json"], bundled: "npm audit" },
	{
		files: ["requirements.txt", "poetry.lock", "Pipfile.lock"],
		systemTool: {
			binary: "pip-audit",
			toolLabel: "pip-audit",
			remediation: "Install: pipx install pip-audit",
		},
	},
	{
		files: ["Cargo.toml"],
		systemTool: {
			binary: "cargo-audit",
			toolLabel: "cargo audit",
			remediation: "Install: cargo install cargo-audit",
			requiresBinaries: ["cargo", "cargo-audit"],
		},
	},
	{
		files: ["go.mod"],
		systemTool: {
			binary: "govulncheck",
			toolLabel: "govulncheck",
			remediation: "Install: go install golang.org/x/vuln/cmd/govulncheck@latest",
		},
	},
	{
		files: [],
		languages: ["csharp"],
		systemTool: {
			binary: "dotnet",
			toolLabel: "dotnet list package --vulnerable",
			remediation: "Install the .NET SDK: https://dotnet.microsoft.com/download",
		},
	},
];

export const planSecurity = (ctx: PlanContext): ToolDecision => {
	const { rootDirectory, projectInfo } = ctx;
	const { installedTools } = projectInfo;
	const hasFile = (relativePath: string): boolean =>
		fs.existsSync(path.join(rootDirectory, relativePath));

	for (const spec of AUDIT_SPECS) {
		const filesMatch = spec.files.some(hasFile);
		const languageMatch = spec.languages?.some((language) =>
			projectInfo.languages.includes(language),
		);
		if (!filesMatch && !languageMatch) continue;
		if (
			languageMatch &&
			spec.languages?.includes("csharp") &&
			ctx.config.lint.csharp?.projectEvaluation !== true
		) {
			return projectEvaluationGate();
		}
		if (spec.bundled) return { tool: spec.bundled, status: "ok" };
		if (spec.systemTool) {
			const required = spec.systemTool.requiresBinaries ?? [spec.systemTool.binary];
			const allPresent = required.every((binary) => installedTools[binary]);
			return allPresent
				? { tool: `${spec.systemTool.toolLabel} (system)`, status: "ok" }
				: {
						tool: `${spec.systemTool.toolLabel} not found`,
						status: "missing",
						remediation: spec.systemTool.remediation,
					};
		}
	}
	return { tool: "no auditor", status: "skipped", skipReason: "no lockfile" };
};

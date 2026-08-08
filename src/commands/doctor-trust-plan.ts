import type { ToolDecision } from "./doctor-plan.js";

export const projectEvaluationGate = (): ToolDecision => ({
	tool: "project-backed C# tools",
	status: "skipped",
	skipReason: "set lint.csharp.projectEvaluation: true only for repositories you trust",
});

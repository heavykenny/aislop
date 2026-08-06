export const SEVERITY_RANK: Record<string, number> = {
	critical: 4,
	high: 3,
	moderate: 2,
	low: 1,
};

export const toSeverity = (value: string): "error" | "warning" =>
	value === "critical" || value === "high" ? "error" : "warning";

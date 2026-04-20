export const AISLOP_SENTINEL_KEY = "__aislop" as const;

const isAislopManaged = (x: unknown): boolean =>
	typeof x === "object" &&
	x !== null &&
	AISLOP_SENTINEL_KEY in (x as Record<string, unknown>) &&
	(x as Record<string, unknown>)[AISLOP_SENTINEL_KEY] != null;

const groupIsAislop = (group: unknown): boolean => {
	if (typeof group !== "object" || group === null) return false;
	const hooks = (group as { hooks?: unknown[] }).hooks;
	if (!Array.isArray(hooks)) return false;
	return hooks.some((h) => isAislopManaged(h));
};

export const upsertHookGroup = (
	config: Record<string, unknown>,
	event: string,
	group: Record<string, unknown>,
): Record<string, unknown> => {
	const next = { ...config };
	const hooks = (next.hooks && typeof next.hooks === "object" ? next.hooks : {}) as Record<
		string,
		unknown
	>;
	const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
	const cleaned = existing.filter((g) => !groupIsAislop(g));
	next.hooks = { ...hooks, [event]: [...cleaned, group] };
	return next;
};

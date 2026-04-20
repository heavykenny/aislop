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

export const upsertFlatHook = (
	config: Record<string, unknown>,
	event: string,
	entry: Record<string, unknown>,
): Record<string, unknown> => {
	const next = { ...config };
	const hooks = (next.hooks && typeof next.hooks === "object" ? next.hooks : {}) as Record<
		string,
		unknown
	>;
	const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
	const cleaned = existing.filter((e) => !isAislopManaged(e));
	next.hooks = { ...hooks, [event]: [...cleaned, entry] };
	return next;
};

export const removeAislopEntries = (
	config: Record<string, unknown>,
	event: string,
): { next: Record<string, unknown>; removed: number } => {
	const next = { ...config };
	const hooks = (next.hooks && typeof next.hooks === "object" ? next.hooks : {}) as Record<
		string,
		unknown
	>;
	const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
	const cleaned = existing.filter((e) => !isAislopManaged(e) && !groupIsAislop(e));
	const removed = existing.length - cleaned.length;
	const nextHooks = { ...hooks };
	if (cleaned.length === 0) delete nextHooks[event];
	else nextHooks[event] = cleaned;
	if (Object.keys(nextHooks).length === 0) delete next.hooks;
	else next.hooks = nextHooks;
	return { next, removed };
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const readString = (record: Record<string, unknown>, key: string): string | undefined => {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
};

export const readRecordArray = (
	record: Record<string, unknown>,
	key: string,
): Record<string, unknown>[] => {
	const value = record[key];
	return Array.isArray(value) ? value.filter(isRecord) : [];
};

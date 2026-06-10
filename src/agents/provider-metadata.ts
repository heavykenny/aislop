type JsonObject = Record<string, unknown>;

export interface ProviderUsage {
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd?: number;
}

interface ProviderOutputMetadata {
	usage?: Partial<ProviderUsage>;
	files: string[];
}

const isObject = (value: unknown): value is JsonObject =>
	typeof value === "object" && value !== null;

const asNumber = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

function parseJsonObject(line: string): JsonObject | null {
	const trimmed = line.trim();
	if (trimmed.charCodeAt(0) !== 123) return null;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function tokenValue(value: JsonObject, names: string[]): number | null {
	for (const name of names) {
		const matched = asNumber(value[name]);
		if (matched !== null) return matched;
	}
	return null;
}

function usageFrom(value: unknown): Partial<ProviderUsage> | null {
	if (!isObject(value)) return null;
	const inputTokens = tokenValue(value, [
		"input_tokens",
		"inputTokens",
		"prompt_tokens",
		"promptTokens",
	]);
	const cacheReadTokenValue = tokenValue(value, [
		"cache_read_input_tokens",
		"cacheReadInputTokens",
	]);
	const cacheCreationTokenValue = tokenValue(value, [
		"cache_creation_input_tokens",
		"cacheCreationInputTokens",
	]);
	const cacheReadTokens = cacheReadTokenValue ?? 0;
	const cacheCreationTokens = cacheCreationTokenValue ?? 0;
	const cachedInputTokens =
		tokenValue(value, ["cached_input_tokens", "cachedInputTokens"]) ??
		(cacheReadTokenValue !== null || cacheCreationTokenValue !== null
			? cacheReadTokens + cacheCreationTokens
			: null);
	const outputTokens = tokenValue(value, [
		"output_tokens",
		"outputTokens",
		"completion_tokens",
		"completionTokens",
	]);
	const directTotalTokens = tokenValue(value, ["total_tokens", "totalTokens"]);
	const costUsd = tokenValue(value, ["cost_usd", "total_cost_usd", "costUsd", "totalCostUsd"]);
	const hasTokenUsage =
		inputTokens !== null ||
		cachedInputTokens !== null ||
		outputTokens !== null ||
		directTotalTokens !== null;
	if (!hasTokenUsage && costUsd === null) {
		return null;
	}
	const totalTokens =
		directTotalTokens ??
		[inputTokens, cachedInputTokens, outputTokens]
			.filter((item): item is number => item !== null)
			.reduce((sum, item) => sum + item, 0);
	return {
		inputTokens: inputTokens ?? 0,
		cachedInputTokens: cachedInputTokens ?? 0,
		outputTokens: outputTokens ?? 0,
		totalTokens,
		...(costUsd !== null ? { costUsd } : {}),
	};
}

const messageFrom = (event: JsonObject): JsonObject | null =>
	isObject(event.message) ? event.message : isObject(event.item) ? event.item : null;

function collectUsage(event: JsonObject): Partial<ProviderUsage> | null {
	const topLevelCost = tokenValue(event, ["cost_usd", "total_cost_usd", "costUsd", "totalCostUsd"]);
	const sources = [
		event.usage,
		event.token_usage,
		event.tokenUsage,
		event.metrics,
		event.context_window,
		event.contextWindow,
		event,
		messageFrom(event)?.usage,
		messageFrom(event)?.metrics,
	];
	for (const source of sources) {
		const usage = usageFrom(source);
		if (!usage) continue;
		return {
			...usage,
			...(usage.costUsd === undefined && topLevelCost !== null ? { costUsd: topLevelCost } : {}),
		};
	}
	return null;
}

function collectFilePaths(value: unknown, files: Set<string>): void {
	if (typeof value === "string") {
		if (/^(?:\.{0,2}\/)?[\w@./ -]+\.[A-Za-z0-9]{1,8}$/.test(value) && !value.includes("\n")) {
			files.add(value.trim());
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectFilePaths(item, files);
		return;
	}
	if (!isObject(value)) return;
	for (const key of ["file", "path", "filePath", "filename", "target_file", "targetFile"]) {
		collectFilePaths(value[key], files);
	}
	if (isObject(value.item)) collectFilePaths(value.item, files);
	if (isObject(value.message)) collectFilePaths(value.message, files);
}

export function extractProviderOutputMetadata(line: string): ProviderOutputMetadata {
	const event = parseJsonObject(line);
	if (!event) return { files: [] };
	const files = new Set<string>();
	collectFilePaths(event, files);
	const usage = collectUsage(event);
	return {
		...(usage ? { usage } : {}),
		files: [...files],
	};
}

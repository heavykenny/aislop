type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
	typeof value === "object" && value !== null;

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const compact = (value: string, limit = 180): string =>
	value.length > limit ? `${value.slice(0, limit - 3)}...` : value;

const parseJsonObject = (line: string): JsonObject | null => {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) return null;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
};

const textFromContent = (content: unknown): string | null => {
	if (typeof content === "string") return asString(content);
	if (!Array.isArray(content)) return null;
	const text = content
		.map((item) => {
			if (typeof item === "string") return item;
			if (!isObject(item)) return "";
			return asString(item.text) ?? asString(item.content) ?? "";
		})
		.filter(Boolean)
		.join(" ");
	return asString(text);
};

const toolNameFromContent = (content: unknown): string | null => {
	if (!Array.isArray(content)) return null;
	for (const item of content) {
		if (!isObject(item)) continue;
		const type = asString(item.type);
		if (type?.includes("tool")) return asString(item.name) ?? type;
	}
	return null;
};

const messageFrom = (event: JsonObject): JsonObject | null =>
	isObject(event.message) ? event.message : isObject(event.item) ? event.item : null;

export const formatProviderOutputLine = (line: string): string | null => {
	const raw = asString(line);
	if (!raw) return null;
	const event = parseJsonObject(raw);
	if (!event) return compact(raw);

	const type = asString(event.type);
	const subtype = asString(event.subtype);
	const message = messageFrom(event);
	const messageContent = message ? textFromContent(message.content) : null;
	const eventContent = textFromContent(event.content);
	const directText = asString(event.text) ?? asString(event.message);
	const toolName =
		toolNameFromContent(message?.content) ??
		toolNameFromContent(event.content) ??
		asString(event.name) ??
		asString(message?.name);
	const command = asString(event.command) ?? asString(message?.command);

	if (messageContent) return compact(`assistant: ${messageContent}`);
	if (eventContent) return compact(`assistant: ${eventContent}`);
	if (directText) return compact(`${type ?? "message"}: ${directText}`);
	if (command) return compact(`exec: ${command}`);
	if (toolName) return compact(`tool: ${toolName}`);
	if (type === "system" && subtype === "init") return "session initialized";
	if (type === "result") return compact(`result: ${subtype ?? "completed"}`);
	if (type?.startsWith("session.")) return compact(type.replace(".", " "));
	if (type) return compact(`event: ${subtype ? `${type}/${subtype}` : type}`);
	return compact(raw);
};

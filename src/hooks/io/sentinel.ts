import crypto from "node:crypto";

export const sentinelHash = (content: string): string =>
	`sha256:${crypto.createHash("sha256").update(content).digest("hex").slice(0, 32)}`;

const BEGIN_RE = /<!--\s*aislop:begin\s+v(\d+)(?:\s+hash=([^\s>]+))?\s*-->/;
const END_RE = /<!--\s*aislop:end\s+v\d+\s*-->/;

interface MarkdownFenceResult {
	nextContent: string;
	replaced: boolean;
}

const renderFence = (body: string, hash: string): string =>
	[`<!-- aislop:begin v1 hash=${hash} -->`, body.trimEnd(), "<!-- aislop:end v1 -->"].join("\n");

export const upsertMarkdownFence = (
	existing: string | null,
	body: string,
	hash: string,
): MarkdownFenceResult => {
	const fenced = renderFence(body, hash);
	if (existing == null || existing.length === 0) {
		return { nextContent: `${fenced}\n`, replaced: false };
	}
	const begin = existing.match(BEGIN_RE);
	const end = existing.match(END_RE);
	if (begin && end && (end.index ?? 0) > (begin.index ?? 0)) {
		const before = existing.slice(0, begin.index);
		const after = existing.slice((end.index ?? 0) + end[0].length);
		return { nextContent: `${before}${fenced}${after}`, replaced: true };
	}
	const joiner = existing.endsWith("\n") ? "" : "\n";
	return { nextContent: `${existing}${joiner}\n${fenced}\n`, replaced: false };
};

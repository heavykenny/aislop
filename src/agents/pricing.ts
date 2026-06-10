export interface TokenUsage {
	in: number;
	out: number;
	cached: number;
	total: number;
}

interface Pricing {
	model: string;
	inPerMTok: number;
	outPerMTok: number;
	contextWindow: number;
}

// Best-effort defaults for the agent TUI sidebar. Prices and models drift over
// time; unknown providers/models return null so the cost and context rows hide.
const MODELS: Record<string, Pricing> = {
	"gpt-5.4": { model: "gpt-5.4", inPerMTok: 1.25, outPerMTok: 10, contextWindow: 400_000 },
	"claude-opus-4-8": {
		model: "claude-opus-4-8",
		inPerMTok: 5,
		outPerMTok: 25,
		contextWindow: 200_000,
	},
	"claude-sonnet-4-6": {
		model: "claude-sonnet-4-6",
		inPerMTok: 3,
		outPerMTok: 15,
		contextWindow: 200_000,
	},
};

const PROVIDER_DEFAULT: Record<string, string> = {
	codex: "gpt-5.4",
	claude: "claude-opus-4-8",
	opencode: "claude-sonnet-4-6",
};

export const resolvePricing = (provider: string, model: string | null): Pricing | null => {
	if (model && MODELS[model]) return MODELS[model];
	const fallback = PROVIDER_DEFAULT[provider.toLowerCase()];
	return fallback ? (MODELS[fallback] ?? null) : null;
};

export const computeCostUsd = (pricing: Pricing | null, tokens: TokenUsage): number | null => {
	if (!pricing) return null;
	return (
		(tokens.in / 1_000_000) * pricing.inPerMTok + (tokens.out / 1_000_000) * pricing.outPerMTok
	);
};

export const contextPct = (pricing: Pricing | null, tokens: TokenUsage): number | null => {
	if (!pricing || pricing.contextWindow <= 0) return null;
	return (tokens.total / pricing.contextWindow) * 100;
};

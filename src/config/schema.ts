import { z } from "zod/v4";

const DEFAULT_WEIGHTS: Record<string, number> = {
	format: 0.3,
	lint: 0.6,
	"code-quality": 0.8,
	"ai-slop": 2.5,
	architecture: 1.0,
	security: 1.5,
};

const EnginesSchema = z.object({
	format: z.boolean().default(true),
	lint: z.boolean().default(true),
	"code-quality": z.boolean().default(true),
	"ai-slop": z.boolean().default(true),
	architecture: z.boolean().default(false),
	security: z.boolean().default(true),
});

const QualitySchema = z.object({
	maxFunctionLoc: z.number().positive().default(80),
	maxFileLoc: z.number().positive().default(400),
	maxNesting: z.number().positive().default(5),
	maxParams: z.number().positive().default(6),
});

const SecurityConfigSchema = z.object({
	audit: z.boolean().default(true),
	auditTimeout: z.number().positive().default(25000),
});

const ThresholdsSchema = z.object({
	good: z.number().default(75),
	ok: z.number().default(50),
});

const ScoringSchema = z.object({
	weights: z.record(z.string(), z.number()).default(DEFAULT_WEIGHTS),
	thresholds: ThresholdsSchema.default(() => ({
		good: 75,
		ok: 50,
	})),
	smoothing: z.number().nonnegative().default(20),
});

const CiSchema = z.object({
	failBelow: z.number().default(0),
	format: z.enum(["json"]).default("json"),
});

const TelemetrySchema = z.object({
	enabled: z.boolean().default(true),
});

const AislopConfigSchema = z.object({
	version: z.number().default(1),
	engines: EnginesSchema.default(() => ({
		format: true,
		lint: true,
		"code-quality": true,
		"ai-slop": true,
		architecture: false,
		security: true,
	})),
	quality: QualitySchema.default(() => ({
		maxFunctionLoc: 80,
		maxFileLoc: 400,
		maxNesting: 5,
		maxParams: 6,
	})),
	security: SecurityConfigSchema.default(() => ({
		audit: true,
		auditTimeout: 25000,
	})),
	scoring: ScoringSchema.default(() => ({
		weights: { ...DEFAULT_WEIGHTS },
		thresholds: {
			good: 75,
			ok: 50,
		},
		smoothing: 20,
	})),
	ci: CiSchema.default(() => ({
		failBelow: 0,
		format: "json" as const,
	})),
	telemetry: TelemetrySchema.default(() => ({
		enabled: true,
	})),
	exclude: z.array(z.string()).default(() => ["node_modules", ".git", "dist", "build", "coverage"]),
});

export type AislopConfig = z.infer<typeof AislopConfigSchema>;

const defaults: AislopConfig = AislopConfigSchema.parse({});

/**
 * Pre-merge scoring weights so partial overrides extend the defaults
 * rather than replacing them entirely (z.record replaces by default).
 */
const preMergeWeights = (raw: Record<string, unknown>): void => {
	const scoring = raw.scoring as Record<string, unknown> | undefined;
	if (!scoring) return;

	const userWeights = scoring.weights as Record<string, number> | undefined;
	if (!userWeights || typeof userWeights !== "object") return;

	scoring.weights = { ...DEFAULT_WEIGHTS, ...userWeights };
};

export const parseConfig = (raw: unknown): AislopConfig => {
	if (!raw || typeof raw !== "object") return defaults;

	try {
		const input = raw as Record<string, unknown>;
		preMergeWeights(input);
		return AislopConfigSchema.parse(input);
	} catch {
		// If validation fails, return defaults rather than crashing
		return defaults;
	}
};

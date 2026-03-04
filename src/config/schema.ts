export interface SlopConfig {
	version: number;
	engines: {
		format: boolean;
		lint: boolean;
		"code-quality": boolean;
		"ai-slop": boolean;
		architecture: boolean;
		security: boolean;
	};
	quality: {
		maxFunctionLoc: number;
		maxFileLoc: number;
		maxNesting: number;
		maxParams: number;
	};
	security: {
		audit: boolean;
		auditTimeout: number;
	};
	scoring: {
		weights: Record<string, number>;
		thresholds: {
			good: number;
			ok: number;
		};
	};
	ci: {
		failBelow: number;
		format: "json" | "sarif";
	};
}

const defaults: SlopConfig = {
	version: 1,
	engines: {
		format: true,
		lint: true,
		"code-quality": true,
		"ai-slop": true,
		architecture: false,
		security: true,
	},
	quality: {
		maxFunctionLoc: 80,
		maxFileLoc: 400,
		maxNesting: 5,
		maxParams: 6,
	},
	security: {
		audit: true,
		auditTimeout: 25000,
	},
	scoring: {
		weights: {
			format: 0.5,
			lint: 1.0,
			"code-quality": 1.5,
			"ai-slop": 1.0,
			architecture: 1.0,
			security: 2.0,
		},
		thresholds: {
			good: 75,
			ok: 50,
		},
	},
	ci: {
		failBelow: 0,
		format: "json",
	},
};

const mergeDeep = (
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> => {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		if (
			source[key] !== null &&
			typeof source[key] === "object" &&
			!Array.isArray(source[key]) &&
			typeof target[key] === "object" &&
			target[key] !== null
		) {
			result[key] = mergeDeep(
				target[key] as Record<string, unknown>,
				source[key] as Record<string, unknown>,
			);
		} else {
			result[key] = source[key];
		}
	}
	return result;
};

export const parseConfig = (raw: unknown): SlopConfig => {
	if (!raw || typeof raw !== "object") return defaults;
	return mergeDeep(
		defaults as unknown as Record<string, unknown>,
		raw as Record<string, unknown>,
	) as unknown as SlopConfig;
};

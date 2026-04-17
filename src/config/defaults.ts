import type { AislopConfig } from "./schema.js";

export const DEFAULT_CONFIG: AislopConfig = {
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
			format: 0.3,
			lint: 0.6,
			"code-quality": 0.8,
			"ai-slop": 2.5,
			architecture: 1.0,
			security: 1.5,
		},
		thresholds: {
			good: 75,
			ok: 50,
		},
		smoothing: 20,
	},
	ci: {
		failBelow: 0,
		format: "json",
	},
	telemetry: {
		enabled: true,
	},
};

export const DEFAULT_RULES_YAML = `# Architecture rules (BYO)
# Uncomment and customize to enforce your project's conventions.
#
# rules:
#   - name: no-axios
#     type: forbid_import
#     match: "axios"
#     severity: error
#
#   - name: controller-no-db
#     type: forbid_import_from_path
#     from: "src/controllers/**"
#     forbid: "src/db/**"
#     severity: error
`;

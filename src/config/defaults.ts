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

export const DEFAULT_CONFIG_YAML = `version: 1

engines:
  format: true
  lint: true
  code-quality: true
  ai-slop: true
  architecture: false
  security: true

quality:
  maxFunctionLoc: 80
  maxFileLoc: 400
  maxNesting: 5
  maxParams: 6

security:
  audit: true
  auditTimeout: 25000

scoring:
  weights:
    format: 0.5
    lint: 1.0
    code-quality: 1.5
    ai-slop: 1.0
    architecture: 1.0
    security: 2.0
  thresholds:
    good: 75
    ok: 50

ci:
  failBelow: 0
  format: json
`;

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

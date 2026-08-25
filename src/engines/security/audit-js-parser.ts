import type { Diagnostic } from "../types.js";
import { isRecord, readString } from "./audit-value.js";

export type JsAuditSource = "npm audit" | "pnpm audit" | "bun audit";

const SEVERITY_RANK: Record<string, number> = {
	critical: 4,
	high: 3,
	moderate: 2,
	low: 1,
};

const toSeverity = (value: string): "error" | "warning" =>
	value === "critical" || value === "high" ? "error" : "warning";

interface VulnAggregate {
	packageName: string;
	worstSeverity: string;
	advisories: number;
	recommendations: Set<string>;
	devOnly?: boolean;
}

/**
 * Manifest context used to tell shipped dependencies from test/build tooling.
 * Omit it and every advisory keeps full severity, which is the safe default.
 */
export interface JsAuditManifest {
	runtimeDependencies: Set<string>;
}

/**
 * npm's audit JSON carries no dev flag, but `effects` names the packages that pull a
 * vulnerable one in. Walking that chain tells us whether any runtime dependency reaches it.
 */
const reachesRuntime = (
	packageName: string,
	vulnerabilities: Record<string, unknown>,
	runtimeDependencies: Set<string>,
	visited: Set<string>,
): boolean => {
	if (runtimeDependencies.has(packageName)) return true;
	if (visited.has(packageName)) return false;
	visited.add(packageName);

	const entry = vulnerabilities[packageName];
	if (!isRecord(entry) || !Array.isArray(entry.effects)) return false;

	return entry.effects.some(
		(effect) =>
			typeof effect === "string" &&
			reachesRuntime(effect, vulnerabilities, runtimeDependencies, visited),
	);
};

const upsertVuln = (
	bucket: Map<string, VulnAggregate>,
	packageName: string,
	severity: string,
	recommendation: string,
): void => {
	const existing = bucket.get(packageName);
	if (existing) {
		existing.advisories++;
		if ((SEVERITY_RANK[severity] ?? 0) > (SEVERITY_RANK[existing.worstSeverity] ?? 0)) {
			existing.worstSeverity = severity;
		}
		if (recommendation) existing.recommendations.add(recommendation);
	} else {
		bucket.set(packageName, {
			packageName,
			worstSeverity: severity,
			advisories: 1,
			recommendations: recommendation ? new Set([recommendation]) : new Set(),
		});
	}
};

const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;
const cmpSemver = (a: string, b: string): number => {
	const [, a1, a2, a3] = SEMVER_RE.exec(a) ?? ["", "0", "0", "0"];
	const [, b1, b2, b3] = SEMVER_RE.exec(b) ?? ["", "0", "0", "0"];
	if (Number(a1) !== Number(b1)) return Number(a1) - Number(b1);
	if (Number(a2) !== Number(b2)) return Number(a2) - Number(b2);
	return Number(a3) - Number(b3);
};

const pickBestRecommendation = (recs: string[]): string => {
	if (recs.length <= 1) return recs[0] ?? "";
	const versioned = recs.filter((r) => SEMVER_RE.test(r));
	if (versioned.length === 0) return recs[0];
	return versioned.reduce((best, r) => (cmpSemver(r, best) > 0 ? r : best));
};

const cleanRecommendation = (raw: string): string => {
	const t = raw.trim();
	if (!t || t.toLowerCase() === "none") return "no fix available";
	return t;
};

const aggregateToDiagnostic = (agg: VulnAggregate, source: JsAuditSource): Diagnostic => {
	const recs = [...agg.recommendations];
	const best = cleanRecommendation(pickBestRecommendation(recs));
	const countLabel = agg.advisories > 1 ? ` (${agg.advisories} advisories)` : "";
	const recLabel = best ? ` — ${best}` : "";
	const scopeLabel = agg.devOnly ? ", dev-only" : "";
	return {
		filePath: "package.json",
		engine: "security",
		rule: "security/vulnerable-dependency",
		severity: agg.devOnly ? "info" : toSeverity(agg.worstSeverity),
		message: `${agg.packageName} (${agg.worstSeverity}${scopeLabel})${recLabel}${countLabel}`,
		help: "",
		line: 0,
		column: 0,
		category: "Security",
		fixable: false,
		detail: source === "npm audit" ? "npm" : source === "pnpm audit" ? "pnpm" : "bun",
	};
};

export const parseBunAudit = (output: string): Diagnostic[] => {
	if (!output.trim()) return [];
	try {
		const parsed: unknown = JSON.parse(output);
		if (!isRecord(parsed)) return [];
		const bucket = new Map<string, VulnAggregate>();

		for (const [packageName, advisories] of Object.entries(parsed)) {
			if (!Array.isArray(advisories) || advisories.length === 0) continue;
			for (const advisory of advisories) {
				if (!isRecord(advisory)) continue;
				const severity = (readString(advisory, "severity") ?? "moderate").toLowerCase();
				const recommendation =
					readString(advisory, "title") ??
					readString(advisory, "vulnerable_versions") ??
					readString(advisory, "url") ??
					"";
				upsertVuln(bucket, packageName, severity, recommendation);
			}
		}

		return [...bucket.values()].map((agg) => aggregateToDiagnostic(agg, "bun audit"));
	} catch {
		return [];
	}
};

const parseLegacyAdvisories = (
	advisories: Record<string, unknown>,
	source: JsAuditSource,
): Diagnostic[] => {
	const bucket = new Map<string, VulnAggregate>();

	for (const [key, advisory] of Object.entries(advisories)) {
		if (!isRecord(advisory)) continue;
		const packageName =
			readString(advisory, "module_name") ??
			readString(advisory, "name") ??
			readString(advisory, "package") ??
			key;
		const severity = (readString(advisory, "severity") ?? "moderate").toLowerCase();
		const recommendation =
			readString(advisory, "recommendation") ?? readString(advisory, "title") ?? "";

		upsertVuln(bucket, packageName, severity, recommendation);
	}

	return [...bucket.values()].map((agg) => aggregateToDiagnostic(agg, source));
};

// An object in `via` means this package is the CVE source; a string means it is
// only affected through another, so reporting it would duplicate the root cause.
const carriesAdvisory = (vulnerability: Record<string, unknown>): boolean =>
	Array.isArray(vulnerability.via) && vulnerability.via.some(isRecord);

const parseModernVulnerabilities = (
	vulnerabilities: Record<string, unknown>,
	source: JsAuditSource,
	manifest?: JsAuditManifest,
): Diagnostic[] => {
	const bucket = new Map<string, VulnAggregate>();
	const records = Object.entries(vulnerabilities).filter(
		(entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]),
	);
	const hasRootCauses = records.some(([, vulnerability]) => carriesAdvisory(vulnerability));

	for (const [packageName, vulnerability] of records) {
		if (hasRootCauses && !carriesAdvisory(vulnerability)) continue;
		const severity = (readString(vulnerability, "severity") ?? "moderate").toLowerCase();
		const fixAvailable = vulnerability.fixAvailable;
		const isDirect = vulnerability.isDirect === true;

		let recommendation = "";
		if (fixAvailable === false) {
			recommendation = isDirect
				? "no automatic fix"
				: "transitive — needs override or parent upgrade";
		} else if (!isDirect && fixAvailable === true) {
			recommendation = "transitive — may need override or parent upgrade";
		} else if (isRecord(fixAvailable)) {
			const name = readString(fixAvailable, "name");
			const version = readString(fixAvailable, "version");
			if (name && version) {
				recommendation = `upgrade to ${name}@${version}`;
			}
		}

		upsertVuln(bucket, packageName, severity, recommendation);

		if (manifest) {
			const aggregate = bucket.get(packageName);
			if (aggregate) {
				aggregate.devOnly = !reachesRuntime(
					packageName,
					vulnerabilities,
					manifest.runtimeDependencies,
					new Set(),
				);
			}
		}
	}

	return [...bucket.values()].map((agg) => aggregateToDiagnostic(agg, source));
};

export const parseJsAudit = (
	output: string,
	source: JsAuditSource,
	manifest?: JsAuditManifest,
): Diagnostic[] => {
	if (!output) return [];
	try {
		const parsed: unknown = JSON.parse(output);
		if (!isRecord(parsed)) return [];

		const error = isRecord(parsed.error) ? parsed.error : undefined;
		const errorCode = error ? readString(error, "code") : undefined;
		const errorSummary = error ? readString(error, "summary") : undefined;
		const errorDetail = error ? readString(error, "detail") : undefined;
		if (errorCode === "ENOLOCK") {
			return [
				{
					filePath: "package.json",
					engine: "security",
					rule: "security/dependency-audit-skipped",
					severity: "info",
					message: `Dependency audit skipped (${source}): lockfile is missing`,
					help:
						errorDetail ??
						"Generate a lockfile, then re-run `aislop scan` for dependency vulnerability checks.",
					line: 0,
					column: 0,
					category: "Security",
					fixable: false,
				},
			];
		}
		if (errorSummary || errorCode) {
			return [
				{
					filePath: "package.json",
					engine: "security",
					rule: "security/dependency-audit-skipped",
					severity: "info",
					message: `Dependency audit did not complete (${source})`,
					help:
						errorDetail ??
						errorSummary ??
						"Re-run dependency audit directly to inspect the underlying error.",
					line: 0,
					column: 0,
					category: "Security",
					fixable: false,
				},
			];
		}

		const advisories = parsed.advisories;
		if (isRecord(advisories)) {
			return parseLegacyAdvisories(advisories, source);
		}

		const vulnerabilities = parsed.vulnerabilities;
		if (isRecord(vulnerabilities)) {
			return parseModernVulnerabilities(vulnerabilities, source, manifest);
		}

		return [];
	} catch {
		return [];
	}
};

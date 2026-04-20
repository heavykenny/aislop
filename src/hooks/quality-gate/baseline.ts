import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/index.js";
import { runEngines } from "../../engines/orchestrator.js";
import type { EngineContext, EngineName } from "../../engines/types.js";
import { calculateScore } from "../../scoring/index.js";
import { discoverProject } from "../../utils/discover.js";
import { atomicWrite, readIfExists } from "../io/atomic-write.js";

interface Baseline {
	schema: "aislop.baseline.v1";
	updatedAt: string;
	score: number;
	byEngine: Record<string, number>;
	fileCount: number;
	commit?: string;
}

const BASELINE_REL = path.join(".aislop", "baseline.json");

export const baselinePath = (cwd: string): string => path.join(cwd, BASELINE_REL);

export const readBaseline = (cwd: string): Baseline | null => {
	const raw = readIfExists(baselinePath(cwd));
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Baseline;
		if (parsed.schema !== "aislop.baseline.v1") return null;
		return parsed;
	} catch {
		return null;
	}
};

export const writeBaseline = (cwd: string, baseline: Baseline): string => {
	const target = baselinePath(cwd);
	atomicWrite(target, `${JSON.stringify(baseline, null, 2)}\n`);
	return target;
};

export const captureBaseline = async (
	cwd: string,
): Promise<{ score: number; fileCount: number; path: string }> => {
	const project = await discoverProject(cwd);
	const config = loadConfig(cwd);
	const context: EngineContext = {
		rootDirectory: project.rootDirectory,
		languages: project.languages,
		frameworks: project.frameworks,
		files: [],
		installedTools: project.installedTools,
		config: {
			quality: config.quality,
			security: { audit: false, auditTimeout: 0 },
		},
	};
	const enabled: Record<EngineName, boolean> = {
		format: config.engines.format,
		lint: config.engines.lint,
		"code-quality": config.engines["code-quality"],
		"ai-slop": config.engines["ai-slop"],
		architecture: config.engines.architecture,
		security: false,
	};
	const results = await runEngines(context, enabled);
	const diagnostics = results.flatMap((r) => r.diagnostics);
	const { score } = calculateScore(
		diagnostics,
		config.scoring.weights,
		config.scoring.thresholds,
		project.sourceFileCount,
		config.scoring.smoothing,
	);
	const byEngine: Record<string, number> = {};
	for (const r of results) {
		const engineDiags = diagnostics.filter((d) => r.diagnostics.includes(d));
		const { score: engineScore } = calculateScore(
			engineDiags,
			config.scoring.weights,
			config.scoring.thresholds,
			project.sourceFileCount,
			config.scoring.smoothing,
		);
		byEngine[r.engine] = engineScore;
	}
	const baseline: Baseline = {
		schema: "aislop.baseline.v1",
		updatedAt: new Date().toISOString(),
		score,
		byEngine,
		fileCount: project.sourceFileCount,
	};
	const target = writeBaseline(cwd, baseline);
	return { score, fileCount: project.sourceFileCount, path: target };
};

export const appendSessionFiles = (cwd: string, files: string[]): void => {
	if (files.length === 0) return;
	const target = path.join(cwd, ".aislop", "session.jsonl");
	try {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		const line = `${JSON.stringify({ ts: Date.now(), files })}\n`;
		fs.appendFileSync(target, line);
	} catch {
		// best-effort; quality gate is non-critical
	}
};

export const readSessionFiles = (cwd: string): string[] => {
	const target = path.join(cwd, ".aislop", "session.jsonl");
	const raw = readIfExists(target);
	if (!raw) return [];
	const files = new Set<string>();
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line) as { files?: string[] };
			for (const f of entry.files ?? []) files.add(f);
		} catch {
			// skip malformed line
		}
	}
	return Array.from(files);
};

export const clearSessionFiles = (cwd: string): void => {
	const target = path.join(cwd, ".aislop", "session.jsonl");
	try {
		fs.unlinkSync(target);
	} catch {
		// already gone
	}
};

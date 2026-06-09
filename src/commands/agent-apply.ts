import fs from "node:fs";
import path from "node:path";
import type { AgentSessionEvent } from "../agents/session-store.js";
import { readAgentSessionEvents, resolveAgentSessionPath } from "../agents/session-store.js";
import { diffNameOnly, readBinaryDiff } from "../agents/worktree.js";
import { renderDisplayRows, renderDisplaySection } from "../ui/display.js";
import { renderHeader } from "../ui/header.js";
import { log } from "../ui/logger.js";
import { confirm, isCancel } from "../ui/prompts.js";
import { APP_VERSION } from "../version.js";
import { applyDiff } from "./agent-local-cli.js";
import { resolveAgentGitRoot } from "./agent-session-root.js";

interface AgentApplyOptions {
	root: string;
	dryRun: boolean;
	yes: boolean;
}

interface AgentApplyTarget {
	sessionId: string;
	sessionPath: string;
	targetRoot: string;
	worktreePath: string;
	worktreeRemoved: boolean;
	alreadyApplied: boolean;
}

interface AgentApplyPreview {
	target: AgentApplyTarget;
	changedFiles: string[];
	patchBytes: number;
	dryRun: boolean;
}

const asString = (value: unknown): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const isInside = (base: string, target: string): boolean => {
	const relative = path.relative(base, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const displayPath = (base: string, target: string): string =>
	isInside(base, target) ? path.relative(base, target) || "." : target;

const appendApplyEvent = (
	sessionPath: string,
	sessionId: string,
	payload: Record<string, unknown>,
): void => {
	fs.appendFileSync(
		sessionPath,
		`${JSON.stringify({
			type: "diff.applied",
			timestamp: new Date().toISOString(),
			sessionId,
			source: "agent apply",
			...payload,
		})}\n`,
		"utf-8",
	);
};

export const resolveAgentApplyTarget = (input: {
	root: string;
	sessionPath: string;
	events: AgentSessionEvent[];
}): AgentApplyTarget => {
	const sessionId = path.basename(input.sessionPath, ".jsonl");
	const kickoff = input.events.find(
		(event) => event.type === "session.started" || event.type === "session.queued",
	);
	const targetRoot = asString(kickoff?.root) ?? input.root;
	const worktree = [...input.events].reverse().find((event) => event.type === "worktree.prepared");
	const worktreePath = asString(worktree?.path);
	if (!worktreePath) {
		throw new Error("This session does not have an isolated worktree to apply.");
	}
	const alreadyApplied = input.events.some((event) => event.type === "diff.applied");
	const worktreeRemoved = input.events.some(
		(event) => event.type === "worktree.removed" && asString(event.path) === worktreePath,
	);
	if (worktreePath === targetRoot) {
		throw new Error(
			"This session already ran in the current worktree; there is no later diff to apply.",
		);
	}
	return {
		sessionId,
		sessionPath: input.sessionPath,
		targetRoot,
		worktreePath,
		worktreeRemoved,
		alreadyApplied,
	};
};

export const renderAgentApplyPreview = (preview: AgentApplyPreview): string => {
	const lines = [
		renderHeader({
			version: APP_VERSION,
			command: "Agent apply",
			context: [preview.target.sessionId],
		}).trimEnd(),
		"",
		renderDisplaySection("Patch"),
		...renderDisplayRows(
			[
				{
					label: "Session",
					value: displayPath(preview.target.targetRoot, preview.target.sessionPath),
				},
				{ label: "Target", value: preview.target.targetRoot },
				{ label: "Worktree", value: preview.target.worktreePath },
				{ label: "Bytes", value: String(preview.patchBytes) },
				{ label: "Changed", value: String(preview.changedFiles.length) },
			],
			{ indent: 3 },
		),
	];
	if (preview.changedFiles.length > 0) {
		lines.push("", renderDisplaySection("Files"));
		for (const file of preview.changedFiles.slice(0, 12)) lines.push(` - ${file}`);
		if (preview.changedFiles.length > 12) {
			lines.push(` - ...and ${preview.changedFiles.length - 12} more`);
		}
	}
	lines.push(
		"",
		renderDisplaySection("Next"),
		...renderDisplayRows([
			{
				label: "Apply",
				value: preview.dryRun ? "rerun without --dry-run" : "patch target worktree index",
			},
		]),
	);
	return `${lines.join("\n")}\n`;
};

export const agentApplyCommand = async (
	session: string | undefined,
	options: AgentApplyOptions,
): Promise<void> => {
	try {
		const root = await resolveAgentGitRoot(options.root);
		const sessionPath = resolveAgentSessionPath(root, session);
		if (!sessionPath) {
			throw new Error(
				session ? `No matching agent session: ${session}` : "No agent sessions found.",
			);
		}
		const events = readAgentSessionEvents(sessionPath);
		const target = resolveAgentApplyTarget({ root, sessionPath, events });
		if (target.alreadyApplied) {
			throw new Error("This session diff has already been applied.");
		}
		if (target.worktreeRemoved) {
			throw new Error("This session worktree was removed; there is no diff to apply.");
		}
		if (!fs.existsSync(target.worktreePath)) {
			throw new Error(`Session worktree no longer exists: ${target.worktreePath}`);
		}
		const [changedFiles, patch] = await Promise.all([
			diffNameOnly(target.worktreePath),
			readBinaryDiff(target.worktreePath),
		]);
		if (changedFiles.length === 0 || patch.trim().length === 0) {
			throw new Error("This session worktree has no diff to apply.");
		}
		const preview = {
			target,
			changedFiles,
			patchBytes: Buffer.byteLength(patch),
			dryRun: options.dryRun,
		};
		process.stdout.write(renderAgentApplyPreview(preview));
		if (options.dryRun) return;
		const shouldApply =
			options.yes ||
			(await confirm({
				message: `Apply ${changedFiles.length} file change${changedFiles.length === 1 ? "" : "s"} from ${target.sessionId} to ${path.basename(target.targetRoot)}?`,
				initialValue: false,
			}));
		if (isCancel(shouldApply)) {
			log.warn("Apply cancelled. Worktree left for review.");
			return;
		}
		if (!shouldApply) {
			log.warn("Apply skipped. Worktree left for review.");
			return;
		}
		await applyDiff(target.targetRoot, patch);
		appendApplyEvent(sessionPath, target.sessionId, {
			applyRequested: true,
			changedFiles: changedFiles.length,
			files: changedFiles,
			targetRoot: target.targetRoot,
			worktreePath: target.worktreePath,
		});
		log.success(
			`Applied ${changedFiles.length} file change${changedFiles.length === 1 ? "" : "s"} from ${target.sessionId}.`,
		);
		log.muted(`Inspect with \`aislop agent show ${target.sessionId}\`.`);
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
};

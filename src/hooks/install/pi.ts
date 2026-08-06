import path from "node:path";
import { readIfExists } from "../io/atomic-write.js";
import {
	applyContent,
	applyRemoval,
	emptyResult,
	type HookInstallOpts,
	type HookInstallResult,
	type HookUninstallResult,
} from "./types.js";

interface PiPaths {
	extension: string;
}

export const resolvePiPaths = (opts: HookInstallOpts): PiPaths => {
	const extension =
		opts.scope === "project"
			? path.join(opts.cwd, ".pi", "extensions", "aislop.js")
			: path.join(opts.home, ".pi", "agent", "extensions", "aislop.js");
	return { extension };
};

// pi has no declarative command-hook, so the integration ships as an ESM extension.
export const PI_EXTENSION_SOURCE = `// aislop — auto-generated pi extension. Do not edit by hand.
// Reinstall with: aislop hook install --pi
import { spawn } from "node:child_process";

// Runs the CLI async so a slow scan never blocks pi's event loop, and forwards
// ctx.signal so Esc actually kills the child instead of it running to completion.
const runHook = (bin, args, input, signal) =>
	new Promise((resolve) => {
		const child = spawn(bin, args, { stdio: ["pipe", "pipe", "ignore"] });
		const chunks = [];
		let settled = false;
		let timer;
		const onAbort = () => {
			child.kill();
			finish(null);
		};
		const cleanup = () => {
			if (timer !== undefined) clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		const finish = (value) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		timer = setTimeout(() => {
			child.kill();
			finish(null);
		}, 15000);
		child.stdout.on("data", (c) => chunks.push(c));
		child.on("error", () => finish(null));
		child.on("close", (code) => {
			finish(code === 0 && chunks.length > 0 ? Buffer.concat(chunks).toString("utf-8") : null);
		});
		child.stdin.end(input);
	});

export default function (pi) {
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "edit" && event.toolName !== "write") return;
		if (event.isError) return;
		const filePath = event.input && event.input.path;
		if (typeof filePath !== "string" || filePath.length === 0) return;

		const bin = process.env.AISLOP_BIN || "aislop";
		const payload = JSON.stringify({
			cwd: ctx.cwd,
			file_path: filePath,
			tool_name: event.toolName,
		});

		let out;
		try {
			const stdout = await runHook(bin, ["hook", "pi"], payload, ctx.signal);
			if (!stdout) return;
			out = JSON.parse(stdout);
		} catch {
			return;
		}
		if (!out || !out.message) return;

		return {
			content: [...event.content, { type: "text", text: out.message }],
			isError: event.isError,
		};
	});
}
`;

export const installPi = (opts: HookInstallOpts): HookInstallResult => {
	const paths = resolvePiPaths(opts);
	const result = emptyResult();
	applyContent(result, opts, paths.extension, PI_EXTENSION_SOURCE, "write pi aislop extension");
	return result;
};

export const uninstallPi = (opts: Omit<HookInstallOpts, "qualityGate">): HookUninstallResult => {
	const paths = resolvePiPaths(opts);
	const result: HookUninstallResult = { removed: [], skipped: [] };
	if (readIfExists(paths.extension) != null) {
		applyRemoval(result, opts, paths.extension, null);
	} else {
		result.skipped.push(paths.extension);
	}
	return result;
};

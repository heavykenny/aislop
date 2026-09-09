import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectSilentRecovery } from "../src/engines/ai-slop/silent-recovery.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-silent-recovery-"));
});
afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ctx = (rootDirectory: string): EngineContext => ({
	rootDirectory,
	languages: ["typescript", "python"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
	},
});

const writeFile = (relativePath: string, content: string): void => {
	const full = path.join(tmpDir, relativePath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
};

const silentRecoveryDiags = async () => {
	const diags = await detectSilentRecovery(ctx(tmpDir));
	return diags.filter((d) => d.rule === "ai-slop/silent-recovery");
};

describe("silent-recovery (JS/TS)", () => {
	it("flags catch that logs a message but drops the caught error", async () => {
		writeFile(
			"src/a.ts",
			`export function load() {
	try {
		risky();
	} catch (e) {
		console.warn("load failed");
	}
	return next();
}
`,
		);
		const diags = await silentRecoveryDiags();
		expect(diags).toHaveLength(1);
		expect(diags[0].severity).toBe("warning");
		expect(diags[0].fixable).toBe(false);
	});

	it("does NOT flag a catch that logs the caught error (observable recovery)", async () => {
		writeFile(
			"src/a2.ts",
			`export function load() {
	try {
		risky();
	} catch (e) {
		console.warn("load failed", e);
	}
	return next();
}
`,
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("flags optional-binding catch with only a logger call", async () => {
		writeFile(
			"src/b.ts",
			`export function run() {
	try {
		go();
	} catch {
		logger.error("boom");
	}
}
`,
		);
		const diags = await silentRecoveryDiags();
		expect(diags).toHaveLength(1);
	});

	it("flags multi-line log-only catch body that drops the error", async () => {
		writeFile(
			"src/c.ts",
			`export function run() {
	try {
		go();
	} catch (err) {
		console.error(
			"could not complete the operation",
		);
	}
}
`,
		);
		const diags = await silentRecoveryDiags();
		expect(diags).toHaveLength(1);
	});

	// --- negative fixtures (precision) ---

	it("does NOT flag a catch that rethrows after logging", async () => {
		writeFile(
			"src/d.ts",
			`export function run() {
	try {
		go();
	} catch (e) {
		console.error("failed", e);
		throw e;
	}
}
`,
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag a catch that returns a fallback after logging", async () => {
		writeFile(
			"src/e.ts",
			`export function run() {
	try {
		return go();
	} catch (e) {
		console.warn("using fallback", e);
		return fallback();
	}
}
`,
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag a catch that does real recovery (assignment + call)", async () => {
		writeFile(
			"src/f.ts",
			`export function run() {
	let result = null;
	try {
		result = go();
	} catch (e) {
		console.warn(e);
		result = recover();
	}
	return result;
}
`,
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag an empty catch (that is swallowed-exception's job)", async () => {
		writeFile(
			"src/g.ts",
			`export function run() {
	try {
		go();
	} catch (e) {
	}
}
`,
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag a catch that calls a handler then rejects", async () => {
		writeFile(
			"src/h.ts",
			`export function run() {
	return promise().catch((e) => {
		console.error(e);
		return reject(e);
	});
}
`,
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});
});

describe("silent-recovery (Python)", () => {
	it("flags except that logs a message but drops the caught error", async () => {
		writeFile(
			"src/a.py",
			[
				"def load():",
				"    try:",
				"        risky()",
				"    except Exception as e:",
				"        logging.warning('load failed')",
				"    return next()",
				"",
			].join("\n"),
		);
		const diags = await silentRecoveryDiags();
		expect(diags).toHaveLength(1);
	});

	it("does NOT flag except that logs the caught error (observable recovery)", async () => {
		writeFile(
			"src/a2.py",
			[
				"def load():",
				"    try:",
				"        risky()",
				"    except Exception as e:",
				"        logging.warning('failed: %s', e)",
				"    return next()",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag except that re-raises after logging", async () => {
		writeFile(
			"src/b.py",
			[
				"def load():",
				"    try:",
				"        risky()",
				"    except Exception as e:",
				"        logging.warning('failed: %s', e)",
				"        raise",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag except that returns a fallback after logging", async () => {
		writeFile(
			"src/c.py",
			[
				"def load():",
				"    try:",
				"        return risky()",
				"    except Exception as e:",
				"        logging.error(e)",
				"        return None",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag a bare except: pass (swallowed-exception's job)", async () => {
		writeFile(
			"src/d.py",
			[
				"def load():",
				"    try:",
				"        risky()",
				"    except Exception:",
				"        pass",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag a bare except with logger.exception (traceback is captured automatically)", async () => {
		writeFile(
			"src/e.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.exception('bench run failed')",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag except-as-e with logger.exception even when the binding is unused in the log call", async () => {
		writeFile(
			"src/f.py",
			[
				"def run_benchmark(run_id):",
				"    try:",
				"        execute()",
				"    except Exception as e:",
				"        logger.exception('benchmark run %s crashed', run_id)",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag except that logs with exc_info=True (traceback attached explicitly)", async () => {
		writeFile(
			"src/g.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.error('bench run failed', exc_info=True)",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("flags except that logs with logger.exception(..., exc_info=False) (traceback suppressed)", async () => {
		writeFile(
			"src/h.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.exception('bench run failed', exc_info=False)",
				"",
			].join("\n"),
		);
		const diags = await silentRecoveryDiags();
		expect(diags).toHaveLength(1);
		expect(diags[0].line).toBe(4);
	});

	it("flags except-as-e whose logger.exception spells exc_info = False with spaces", async () => {
		writeFile(
			"src/i.py",
			[
				"def run_benchmark(run_id):",
				"    try:",
				"        execute()",
				"    except Exception as e:",
				"        logger.exception('benchmark run %s crashed', run_id, exc_info = False)",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(1);
	});

	it("does NOT flag logger.exception with a non-literal exc_info value (deliberate non-detection)", async () => {
		writeFile(
			"src/j.py",
			[
				"def run_benchmark(verbose):",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.exception('bench run failed', exc_info=verbose)",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("flags a multi-line logger.exception whose exc_info=False sits on its own line", async () => {
		writeFile(
			"src/k.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.exception(",
				"            'bench run failed',",
				"            exc_info=False,",
				"        )",
				"",
			].join("\n"),
		);
		const diags = await silentRecoveryDiags();
		expect(diags).toHaveLength(1);
		expect(diags[0].line).toBe(4);
	});

	it("does NOT flag a multi-line logger.exception that keeps the traceback", async () => {
		writeFile(
			"src/l.py",
			[
				"def run_benchmark(run_id):",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.exception(",
				"            'benchmark run %s crashed',",
				"            run_id,",
				"        )",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	// A keyword argument on its own line used to read as an assignment, which meant the
	// handler looked like it did real work and the whole block was skipped.
	it("flags a multi-line log call carrying an unrelated keyword argument", async () => {
		writeFile(
			"src/m.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.error(",
				"            'bench run failed',",
				"            stacklevel=2,",
				"        )",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(1);
	});

	it("does NOT flag a multi-line handler that assigns before logging", async () => {
		writeFile(
			"src/n.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        summary = {",
				"            'status': 'failed',",
				"        }",
				"        logger.error('bench run failed: %s', summary)",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT join past a bracket that closes inside a string literal", async () => {
		writeFile(
			"src/o.py",
			[
				"def run_benchmark(run_id):",
				"    try:",
				"        execute()",
				"    except Exception as e:",
				"        logger.error('bench run failed :-( for %s', run_id)",
				"        raise",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});
	// The keyword check reads a masked copy of the statement, so prose that merely
	// mentions the keyword cannot cancel the traceback exemption.
	it("does NOT flag a multi-line logger.exception whose message mentions exc_info=False", async () => {
		writeFile(
			"src/p.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.exception(",
				"            'bench run failed, pass exc_info=False to hide the traceback',",
				"        )",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag a handler whose log call is followed by a semicolon-joined raise", async () => {
		writeFile(
			"src/q.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.error(",
				"            'bench run failed',",
				"        ); raise",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("does NOT flag a single-line log and raise separated by a semicolon", async () => {
		writeFile(
			"src/r.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.error('bench run failed'); raise",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	// The bound name is looked for in the unmasked text, so an f-string still counts.
	it("does NOT flag a multi-line log that interpolates the caught error", async () => {
		writeFile(
			"src/s.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception as e:",
				"        logger.error(",
				"            f'bench run failed: {e}',",
				"        )",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(0);
	});

	it("flags a multi-line handler whose trailing comment mentions raise", async () => {
		writeFile(
			"src/t.py",
			[
				"def run_benchmark():",
				"    try:",
				"        execute()",
				"    except Exception:",
				"        logger.error(",
				"            'bench run failed',",
				"        )  # raise once we work out why",
				"",
			].join("\n"),
		);
		expect(await silentRecoveryDiags()).toHaveLength(1);
	});
});

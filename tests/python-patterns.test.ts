import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectPythonPatterns } from "../src/engines/ai-slop/python-patterns.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildContext = (): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["python"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-py-patterns-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("python: bare-except", () => {
	it("flags `except:` with no exception class", async () => {
		writeFile("src/risky.py", ["try:", "    do_something()", "except:", "    pass", ""].join("\n"));
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-bare-except");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(3);
	});

	it("does NOT flag `except ValueError:` or `except (A, B):`", async () => {
		writeFile(
			"src/clean.py",
			[
				"try:",
				"    do_something()",
				"except ValueError:",
				"    handle()",
				"except (KeyError, IndexError) as e:",
				"    log(e)",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-bare-except");
		expect(matches).toEqual([]);
	});
});

describe("python: broad-except with silent body", () => {
	it("flags `except Exception: pass`", async () => {
		writeFile(
			"src/swallow.py",
			["try:", "    do_thing()", "except Exception:", "    pass", ""].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-broad-except");
		expect(matches).toHaveLength(1);
	});

	it("does NOT flag `except Exception:` with a real handler", async () => {
		writeFile(
			"src/handle.py",
			[
				"import logging",
				"log = logging.getLogger(__name__)",
				"try:",
				"    do_thing()",
				"except Exception as e:",
				"    log.error('failed', exc_info=e)",
				"    raise",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-broad-except");
		expect(matches).toEqual([]);
	});
});

describe("python: mutable-default-arg", () => {
	it("flags `def f(items=[])`", async () => {
		writeFile(
			"src/bug.py",
			["def append_to(items=[]):", "    items.append(1)", "    return items", ""].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-mutable-default");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(1);
	});

	it("flags `def f(opts={})` and `def f(s=set())`", async () => {
		writeFile(
			"src/multi.py",
			[
				"def use_dict(opts={}):",
				"    return opts",
				"def use_set(s=set()):",
				"    return s",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-mutable-default");
		expect(matches).toHaveLength(2);
	});

	it("does NOT flag `=None` or immutable defaults", async () => {
		writeFile(
			"src/safe.py",
			["def f(x=None, y=0, z='', flag=True):", "    return (x, y, z, flag)", ""].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-mutable-default");
		expect(matches).toEqual([]);
	});

	it("handles a multi-line signature with mutable default in the middle", async () => {
		writeFile(
			"src/multi-line.py",
			[
				"def long_signature(",
				"    a: int,",
				"    b: str = '',",
				"    c: list = [],",
				"    d: bool = True,",
				"):",
				"    return (a, b, c, d)",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-mutable-default");
		expect(matches).toHaveLength(1);
	});
});

describe("python: print-debug", () => {
	it("flags `print(...)` in a regular module", async () => {
		writeFile(
			"src/foo.py",
			["def reconcile(orders):", "    print('debug', len(orders))", "    return orders", ""].join(
				"\n",
			),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-print-debug");
		expect(matches).toHaveLength(1);
	});

	it("does NOT flag `print()` in test files", async () => {
		writeFile(
			"tests/test_foo.py",
			["def test_thing():", "    print('debugging')", "    assert True", ""].join("\n"),
		);
		writeFile(
			"src/foo_test.py",
			["def test_other():", "    print('also debugging')", "", ""].join("\n"),
		);
		writeFile("conftest.py", ["print('conftest hint')", ""].join("\n"));
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-print-debug");
		expect(matches).toEqual([]);
	});

	it("does NOT flag `print()` in __main__.py / manage.py / setup.py", async () => {
		writeFile("__main__.py", ["print('cli output')", ""].join("\n"));
		writeFile("manage.py", ["print('django mgmt')", ""].join("\n"));
		writeFile("setup.py", ["print('setup output')", ""].join("\n"));
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-print-debug");
		expect(matches).toEqual([]);
	});

	it('does NOT flag `print()` in files containing `if __name__ == "__main__":` (CLI-script idiom)', async () => {
		writeFile(
			"src/help.py",
			[
				"def main():",
				"    print('debug-style output')",
				"",
				"if __name__ == '__main__':",
				"    main()",
				"",
			].join("\n"),
		);
		writeFile(
			"src/certs.py",
			[
				"from certifi import where",
				"",
				"if __name__ == '__main__':",
				"    print(where())",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-print-debug");
		expect(matches).toEqual([]);
	});

	it("does NOT flag `print()` in files under scripts/ / bin/ / .github/ directories", async () => {
		writeFile("scripts/seed-db.py", ["print('seeding')", ""].join("\n"));
		writeFile("bin/migrate.py", ["print('migrating')", ""].join("\n"));
		writeFile(".github/workflows/release-notes.py", ["print('release notes')", ""].join("\n"));
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-print-debug");
		expect(matches).toEqual([]);
	});

	it("does NOT flag `print()` in docs / docs_src / examples / action directories", async () => {
		writeFile("docs/conf.py", ["print('built docs')", ""].join("\n"));
		writeFile(
			"docs_src/python_types/tutorial001.py",
			["print('this is a tutorial')", ""].join("\n"),
		);
		writeFile("examples/quickstart.py", ["print('hello world')", ""].join("\n"));
		writeFile("action/main.py", ["print('GH action log')", ""].join("\n"));
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-print-debug");
		expect(matches).toEqual([]);
	});

	it("does NOT flag `print()` in files named tutorial*.py", async () => {
		writeFile("src/some_path/tutorial_intro.py", ["print('tutorial output')", ""].join("\n"));
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-print-debug");
		expect(matches).toEqual([]);
	});

	it("does NOT flag `print()` inside a triple-quoted docstring", async () => {
		writeFile(
			"src/lib.py",
			[
				"def fetch(url: str) -> dict:",
				'    """Fetch JSON from a URL.',
				"",
				"    Example:",
				"        data = fetch('https://api.example.com')",
				"        print(data)",
				'    """',
				"    return {}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-print-debug");
		expect(matches).toEqual([]);
	});

	it("STILL flags `print()` outside the docstring even when other prints are inside", async () => {
		writeFile(
			"src/mixed.py",
			[
				"def fetch(url: str) -> dict:",
				'    """Fetch.',
				"        print('inside docstring')",
				'    """',
				"    print('this is real code')",
				"    return {}",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-print-debug");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(5);
	});
});

describe("python: SCBench-inspired verbosity patterns", () => {
	it("flags `range(len(...))` loops", async () => {
		writeFile(
			"src/range_len.py",
			[
				"def names(users):",
				"    out = []",
				"    for i in range(len(users)):",
				"        out.append(users[i].name)",
				"    return out",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-range-len-loop");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(3);
		expect(matches[0].severity).toBe("info");
	});

	it("does NOT flag direct iteration or enumerate", async () => {
		writeFile(
			"src/iterate.py",
			[
				"def names(users):",
				"    for user in users:",
				"        yield user.name",
				"",
				"def indexed(users):",
				"    for i, user in enumerate(users):",
				"        yield i, user.name",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-range-len-loop");
		expect(matches).toEqual([]);
	});

	it("flags chained `.get(..., {})` fallback lookups", async () => {
		writeFile(
			"src/config.py",
			[
				"def timeout(config):",
				"    return config.get('service', {}).get('http', {}).get('timeout', 30)",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-chained-dict-get");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(2);
	});

	it("does NOT flag explicit nested lookup steps", async () => {
		writeFile(
			"src/config_clean.py",
			[
				"def timeout(config):",
				"    service = config.get('service')",
				"    if service is None:",
				"        return 30",
				"    http = service.get('http')",
				"    if http is None:",
				"        return 30",
				"    return http.get('timeout', 30)",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-chained-dict-get");
		expect(matches).toEqual([]);
	});

	it("flags repeated selector dispatch ladders", async () => {
		writeFile(
			"src/selector.py",
			[
				"def normalize(selector, node):",
				"    if selector == 'string_literal':",
				"        return node.kind in ('string', 'raw_string')",
				"    elif selector == 'numeric_literal':",
				"        return node.kind in ('number', 'integer', 'float')",
				"    elif selector == 'boolean_literal':",
				"        return node.kind in ('true', 'false')",
				"    elif selector == 'null_literal':",
				"        return node.kind in ('null', 'none')",
				"    return False",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-repetitive-dispatch");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(2);
	});

	it("flags repeated isinstance ladders", async () => {
		writeFile(
			"src/types.py",
			[
				"def encode(value):",
				"    if isinstance(value, str):",
				"        return value",
				"    elif isinstance(value, int):",
				"        return str(value)",
				"    elif isinstance(value, float):",
				"        return str(value)",
				"    elif isinstance(value, bool):",
				"        return 'true' if value else 'false'",
				"    return ''",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		const matches = diagnostics.filter((d) => d.rule === "ai-slop/python-isinstance-ladder");
		expect(matches).toHaveLength(1);
		expect(matches[0].line).toBe(2);
	});

	it("does NOT flag short branch ladders", async () => {
		writeFile(
			"src/short.py",
			[
				"def encode(value):",
				"    if isinstance(value, str):",
				"        return value",
				"    elif isinstance(value, int):",
				"        return str(value)",
				"    return ''",
				"",
			].join("\n"),
		);
		const diagnostics = await detectPythonPatterns(buildContext());
		expect(diagnostics.filter((d) => d.rule === "ai-slop/python-isinstance-ladder")).toEqual([]);
		expect(diagnostics.filter((d) => d.rule === "ai-slop/python-repetitive-dispatch")).toEqual([]);
	});
});

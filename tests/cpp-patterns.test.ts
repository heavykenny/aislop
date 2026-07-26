import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectCppPatterns } from "../src/engines/ai-slop/cpp-patterns.js";
import type { EngineContext } from "../src/engines/types.js";

const ctx = (root: string): EngineContext => ({
	rootDirectory: root,
	languages: ["cpp"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

const write = (root: string, name: string, body: string) => {
	const dir = path.dirname(path.join(root, name));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(root, name), body);
};

const rulesFor = async (files: Record<string, string>) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-cpp-"));
	for (const [name, body] of Object.entries(files)) {
		write(root, name, body);
	}
	const diags = await detectCppPatterns(ctx(root));
	return diags.map((d) => d.rule);
};

describe("detectCppPatterns", () => {
	it("flags a not-implemented stub", async () => {
		const rules = await rulesFor({
			"src/a.cpp": 'int f() { throw std::logic_error("not implemented yet"); }\n',
		});
		expect(rules).toContain("ai-slop/cpp-not-implemented");
	});

	it("flags using namespace std in a header but not in a .cpp", async () => {
		expect(await rulesFor({ "src/a.hpp": "using namespace std;\n" })).toContain(
			"ai-slop/cpp-using-namespace-std-in-header",
		);
		expect(await rulesFor({ "src/a.cpp": "using namespace std;\n" })).not.toContain(
			"ai-slop/cpp-using-namespace-std-in-header",
		);
	});

	it("flags a C-style cast in C++ but not in a .c file", async () => {
		expect(await rulesFor({ "src/a.cpp": "double d = (int)x + 1;\n" })).toContain(
			"ai-slop/cpp-c-style-cast",
		);
		expect(await rulesFor({ "src/a.c": "double d = (int)x + 1;\n" })).not.toContain(
			"ai-slop/cpp-c-style-cast",
		);
	});

	it("flags manual delete and stray std::cout outside main", async () => {
		expect(await rulesFor({ "src/a.cpp": "void f(int* p){ delete p; }\n" })).toContain(
			"ai-slop/cpp-manual-delete",
		);
		expect(await rulesFor({ "src/lib.cpp": 'void log(){ std::cout << "x"; }\n' })).toContain(
			"ai-slop/cpp-iostream-leftover",
		);
	});

	it("does not flag std::cout in a file with int main()", async () => {
		expect(
			await rulesFor({ "src/main.cpp": "int main(){ std::cout << 1; return 0; }\n" }),
		).not.toContain("ai-slop/cpp-iostream-leftover");
	});

	it("flags NULL in C++ but not in a .c file", async () => {
		expect(await rulesFor({ "src/a.cpp": "int* p = NULL;\n" })).toContain(
			"ai-slop/cpp-null-literal",
		);
		expect(await rulesFor({ "src/a.c": "int* p = NULL;\n" })).not.toContain(
			"ai-slop/cpp-null-literal",
		);
	});

	it("flags an object-like #define constant but not function-like macros or header guards", async () => {
		expect(await rulesFor({ "src/a.cpp": "#define MAX_SIZE 1024\n" })).toContain(
			"ai-slop/cpp-define-constant",
		);
		expect(await rulesFor({ "src/a.cpp": '#define VERSION "1.0"\n' })).toContain(
			"ai-slop/cpp-define-constant",
		);
		expect(await rulesFor({ "src/a.cpp": "#define SQUARE(x) ((x) * (x))\n" })).not.toContain(
			"ai-slop/cpp-define-constant",
		);
		expect(await rulesFor({ "src/a.hpp": "#define MY_HEADER_H\n" })).not.toContain(
			"ai-slop/cpp-define-constant",
		);
	});

	it("flags << std::endl in a stream", async () => {
		expect(await rulesFor({ "src/lib.cpp": 'void f(){ log << "x" << std::endl; }\n' })).toContain(
			"ai-slop/cpp-endl-in-stream",
		);
	});
});

import { describe, expect, it } from "vitest";
import {
	detectInstallChannel,
	fileCountBucket,
	isCiEnv,
	scoreBucket,
} from "../../src/telemetry/env.js";

describe("detectInstallChannel", () => {
	it("detects npx from npm_execpath", () => {
		expect(detectInstallChannel({ npm_execpath: "/usr/local/lib/npx/npx-cli.js" })).toBe("npx");
	});

	it("detects npx from npm _npx cache paths", () => {
		expect(
			detectInstallChannel({
				npm_execpath: "/Users/me/.npm/_npx/abc123/node_modules/.bin/aislop-mcp",
			}),
		).toBe("npx");
	});

	it("detects npx from npm_command", () => {
		expect(detectInstallChannel({ npm_command: "npx" })).toBe("npx");
	});

	it("detects pnpm from user-agent", () => {
		expect(detectInstallChannel({ npm_config_user_agent: "pnpm/8.0.0 npm/?" })).toBe("pnpm");
	});

	it("detects yarn from user-agent", () => {
		expect(detectInstallChannel({ npm_config_user_agent: "yarn/1.22.0" })).toBe("yarn");
	});

	it("detects bun from user-agent", () => {
		expect(detectInstallChannel({ npm_config_user_agent: "bun/1.0.0" })).toBe("bun");
	});

	it("detects npm from user-agent", () => {
		expect(detectInstallChannel({ npm_config_user_agent: "npm/10.0.0" })).toBe("npm");
	});

	it("honors AISLOP_INSTALL_CHANNEL override", () => {
		expect(detectInstallChannel({ AISLOP_INSTALL_CHANNEL: "pip" })).toBe("pip");
		expect(detectInstallChannel({ AISLOP_INSTALL_CHANNEL: "homebrew" })).toBe("homebrew");
	});

	it("detects homebrew from Cellar paths before npm signals", () => {
		expect(
			detectInstallChannel(
				{ npm_config_user_agent: "npm/10.0.0" },
				["node", "/opt/homebrew/Cellar/aislop/0.13.0/libexec/node_modules/aislop/dist/cli.js", "scan"],
			),
		).toBe("homebrew");
	});

	it("detects pipx from script path", () => {
		expect(
			detectInstallChannel(
				{},
				["node", "/Users/me/.local/pipx/venvs/aislop/bin/aislop", "scan"],
			),
		).toBe("pipx");
	});

	it("detects direct global installs without npm wrapper signals", () => {
		expect(
			detectInstallChannel(
				{},
				["node", "/usr/local/lib/node_modules/aislop/dist/cli.js", "scan"],
			),
		).toBe("direct");
	});

	it("returns unknown when env and argv carry no install signals", () => {
		expect(detectInstallChannel({}, ["node"])).toBe("unknown");
	});

});

describe("isCiEnv", () => {
	it("returns true for CI=true", () => {
		expect(isCiEnv({ CI: "true" })).toBe(true);
	});

	it("returns true for CI=1", () => {
		expect(isCiEnv({ CI: "1" })).toBe(true);
	});

	it("returns true for GITHUB_ACTIONS=true", () => {
		expect(isCiEnv({ GITHUB_ACTIONS: "true" })).toBe(true);
	});

	it("returns false when no CI signals are present", () => {
		expect(isCiEnv({})).toBe(false);
	});
});

describe("fileCountBucket", () => {
	it("buckets file counts at the right boundaries", () => {
		expect(fileCountBucket(0)).toBe("0-10");
		expect(fileCountBucket(9)).toBe("0-10");
		expect(fileCountBucket(10)).toBe("10-50");
		expect(fileCountBucket(49)).toBe("10-50");
		expect(fileCountBucket(50)).toBe("50-100");
		expect(fileCountBucket(99)).toBe("50-100");
		expect(fileCountBucket(100)).toBe("100-500");
		expect(fileCountBucket(499)).toBe("100-500");
		expect(fileCountBucket(500)).toBe("500-1000");
		expect(fileCountBucket(999)).toBe("500-1000");
		expect(fileCountBucket(1000)).toBe("1000+");
		expect(fileCountBucket(50_000)).toBe("1000+");
	});
});

describe("scoreBucket", () => {
	it("buckets scores at the right boundaries", () => {
		expect(scoreBucket(0)).toBe("0-25");
		expect(scoreBucket(24)).toBe("0-25");
		expect(scoreBucket(25)).toBe("25-50");
		expect(scoreBucket(49)).toBe("25-50");
		expect(scoreBucket(50)).toBe("50-75");
		expect(scoreBucket(74)).toBe("50-75");
		expect(scoreBucket(75)).toBe("75-100");
		expect(scoreBucket(100)).toBe("75-100");
	});
});

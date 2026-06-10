import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import { lintEngine } from "../../src/engines/lint/index.js";
import type { EngineContext } from "../../src/engines/types.js";

const runExpoDoctorMock = vi.fn(async () => []);

vi.mock("../../src/engines/lint/expo-doctor.js", () => ({
	runExpoDoctor: runExpoDoctorMock,
}));

const makeContext = (expoDoctor: boolean): EngineContext => ({
	rootDirectory: process.cwd(),
	languages: [],
	frameworks: ["expo"],
	installedTools: {},
	config: {
		quality: DEFAULT_CONFIG.quality,
		security: DEFAULT_CONFIG.security,
		lint: { ...DEFAULT_CONFIG.lint, expoDoctor },
	},
});

describe("lintEngine Expo Doctor opt-in", () => {
	it("does not invoke Expo Doctor for detected Expo projects by default", async () => {
		runExpoDoctorMock.mockClear();

		await lintEngine.run(makeContext(false));

		expect(runExpoDoctorMock).not.toHaveBeenCalled();
	});

	it("invokes Expo Doctor only when explicitly enabled", async () => {
		runExpoDoctorMock.mockClear();

		await lintEngine.run(makeContext(true));

		expect(runExpoDoctorMock).toHaveBeenCalledTimes(1);
	});
});

import ora from "ora";

interface SpinnerHandle {
	succeed(displayText: string): void;
	fail(displayText: string): void;
	stop(): void;
}

const createNoopHandle = (): SpinnerHandle => ({
	succeed: () => undefined,
	fail: () => undefined,
	stop: () => undefined,
});

const shouldRenderSpinner = (): boolean =>
	Boolean(process.stderr.isTTY) &&
	process.env.CI !== "true" &&
	process.env.CI !== "1";

export const spinner = (text: string) => ({
	start(): SpinnerHandle {
		if (!shouldRenderSpinner()) {
			return createNoopHandle();
		}

		const instance = ora({ text }).start();
		return {
			succeed: (displayText: string) => instance.succeed(displayText),
			fail: (displayText: string) => instance.fail(displayText),
			stop: () => instance.stop(),
		};
	},
});

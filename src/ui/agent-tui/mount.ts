import type { SessionStore } from "../../agents/session-state.js";

export interface TuiHandle {
	close(): Promise<void>;
}

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

// Lazy-imports ink + react so they never touch the cold-start path of `scan`
// and the other commands. Opens the alt-screen buffer so the agent takes over
// the full terminal, then restores the shell exactly as it was on unmount.
export const mountAgentTui = async (store: SessionStore): Promise<TuiHandle> => {
	const [{ render }, React, { AgentApp }] = await Promise.all([
		import("ink"),
		import("react"),
		import("./AgentApp.js"),
	]);

	process.stdout.write(ALT_SCREEN_ON + HIDE_CURSOR);
	const instance = render(React.createElement(AgentApp, { store }), { exitOnCtrlC: false });

	return {
		close: async () => {
			instance.unmount();
			// Wait for Ink to flush its final teardown BEFORE leaving the alt-screen,
			// otherwise the last frame bleeds onto the restored shell.
			await instance.waitUntilExit();
			process.stdout.write(SHOW_CURSOR + ALT_SCREEN_OFF);
		},
	};
};

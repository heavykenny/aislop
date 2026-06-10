import type { AgentOptions } from "./agent-types.js";

export interface AgentMonitorOptions extends AgentOptions {
	interval: number;
	debounce: number;
	once: boolean;
	repair: boolean;
}

import { useEffect, useState } from "react";
import type { AgentSessionState, SessionStore } from "../../agents/session-state.js";

// The store mutates its state object in place and returns the same reference,
// so we force a re-render on every notification rather than relying on snapshot
// identity (which useSyncExternalStore would treat as "unchanged").
export const useStore = (store: SessionStore): AgentSessionState => {
	const [, setTick] = useState(0);
	useEffect(() => {
		return store.subscribe(() => setTick((t) => t + 1));
	}, [store]);
	return store.getState();
};

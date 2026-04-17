import { cancel, confirm, intro, isCancel, multiselect, outro, select, text } from "@clack/prompts";

export { cancel, confirm, intro, isCancel, multiselect, outro, select, text };

/**
 * Wrap a clack prompt flow so a cancel turns into `undefined` instead of
 * propagating the clack cancel symbol. Callers treat `undefined` as
 * "user aborted" and exit cleanly.
 */
export const runCancellable = async <T>(fn: () => Promise<T | symbol>): Promise<T | undefined> => {
	const value = await fn();
	if (isCancel(value)) return undefined;
	return value as T;
};

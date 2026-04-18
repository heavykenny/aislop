import { cancel, confirm, intro, isCancel, multiselect, outro, select, text } from "@clack/prompts";

export { cancel, confirm, intro, isCancel, multiselect, outro, select, text };

export const runCancellable = async <T>(fn: () => Promise<T | symbol>): Promise<T | undefined> => {
	const value = await fn();
	if (isCancel(value)) return undefined;
	return value as T;
};

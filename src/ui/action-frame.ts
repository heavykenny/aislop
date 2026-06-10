import { highlightAislop } from "./brand.js";
import { style, theme } from "./theme.js";

interface ActionFrameInput {
	label: string;
	hint?: string;
}

export const renderActionStart = (input: ActionFrameInput): string => {
	const hint = input.hint ? ` ${highlightAislop(`· ${input.hint}`, theme, "muted")}` : "";
	return `\n ${style(theme, "muted", "┌")} ${style(theme, "accent", input.label)}${hint}\n\n`;
};

export const renderActionEnd = (
	input: ActionFrameInput & { status?: "complete" | "skipped" },
): string => {
	const status = input.status ?? "complete";
	const token = status === "complete" ? "success" : "muted";
	const text = status === "complete" ? `${input.label} complete` : `${input.label} skipped`;
	return `\n ${style(theme, "muted", "└")} ${style(theme, token, text)}\n`;
};

export const terminalLink = (url: string, label = url): string => {
	if (!process.stdout.isTTY || process.env.TERM === "dumb") return label;
	return `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007`;
};

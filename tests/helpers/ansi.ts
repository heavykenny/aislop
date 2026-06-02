export const ANSI_ESCAPE = "\u001B";

const ANSI_RE = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, "g");

export const stripAnsi = (value: string): string => value.replace(ANSI_RE, "");

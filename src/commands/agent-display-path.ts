import path from "node:path";
import { toPosix } from "../utils/paths.js";

export const displayAgentPath = (root: string, target: string): string => {
	const relative = path.relative(root, target);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return target;
	return toPosix(relative);
};

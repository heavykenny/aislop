import fs from "node:fs";
import path from "node:path";
import type { Diagnostic, EngineContext } from "../types.js";
import { collectBlocks, getCommentSyntax } from "./comment-blocks.js";
import { detectNarrativeComments } from "./narrative-comments.js";

export const fixNarrativeComments = async (context: EngineContext): Promise<void> => {
	const diagnostics = await detectNarrativeComments(context);
	if (diagnostics.length === 0) return;

	const byFile = new Map<string, Diagnostic[]>();
	for (const d of diagnostics) {
		const abs = d.filePath.startsWith("/") ? d.filePath : `${context.rootDirectory}/${d.filePath}`;
		const list = byFile.get(abs) ?? [];
		list.push(d);
		byFile.set(abs, list);
	}

	for (const [filePath, diags] of byFile) {
		const ext = path.extname(filePath);
		const syntax = getCommentSyntax(ext);
		if (!syntax) continue;
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}
		const lines = content.split("\n");
		const blocks = collectBlocks(lines, syntax);
		const toRemove = new Set<number>();
		for (const d of diags) {
			const block = blocks.find((b) => b.startLine === d.line);
			if (!block) continue;
			for (let ln = block.startLine; ln <= block.endLine; ln += 1) {
				toRemove.add(ln);
			}
			const prev = block.startLine - 1;
			const next = block.endLine + 1;
			const prevIsBlank = prev >= 1 && lines[prev - 1]?.trim() === "";
			const nextIsBlank = next <= lines.length && lines[next - 1]?.trim() === "";
			if (prevIsBlank && nextIsBlank) {
				toRemove.add(prev);
			}
		}

		const kept: string[] = [];
		for (let i = 0; i < lines.length; i += 1) {
			if (!toRemove.has(i + 1)) kept.push(lines[i]);
		}

		const newContent = kept.join("\n");
		if (newContent !== content) {
			fs.writeFileSync(filePath, newContent);
		}
	}
};

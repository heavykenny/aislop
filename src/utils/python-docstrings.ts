// Shared across ai-slop detectors that need to tell Python docstring content
// (module/class/function-leading triple-quoted string expressions, or any
// other triple-quoted string) apart from executable code, so documentation
// examples (a print() sample, a format-string URL) don't get flagged as if
// they were runtime behavior.

/** Line indices (0-based) that fall inside a `"""..."""` / `'''...'''` span. */
export const buildDocstringRanges = (lines: string[]): Set<number> => {
	const inside = new Set<number>();
	let openDelim: '"""' | "'''" | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (openDelim) {
			inside.add(i);
			if (line.includes(openDelim)) openDelim = null;
			continue;
		}
		// Find an opening triple-quote that isn't closed on the same line.
		for (const delim of ['"""', "'''"] as const) {
			const first = line.indexOf(delim);
			if (first === -1) continue;
			const second = line.indexOf(delim, first + 3);
			if (second === -1) {
				openDelim = delim;
				inside.add(i);
				break;
			}
		}
	}
	return inside;
};

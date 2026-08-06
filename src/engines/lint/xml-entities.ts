// Decodes the handful of XML entities that appear in roslynator/jb report text.
// Both parsers avoid a full XML dependency, so this stays a plain string replace.
export const decodeEntities = (value: string): string =>
	value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");

// Reads one `name="value"` attribute out of a single XML tag string. Shared by
// the regex-based (no XML dependency) parsers for cppcheck, jb, and roslynator
// output; returns null when the attribute is absent.
export const xmlAttribute = (tag: string, name: string): string | null =>
	new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

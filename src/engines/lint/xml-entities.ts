// Decodes the handful of XML entities that appear in roslynator/jb report text.
// Both parsers avoid a full XML dependency, so this stays a plain string replace.
export const decodeEntities = (value: string): string =>
	value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");

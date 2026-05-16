type Language = "typescript" | "javascript" | "python" | "java";

const ALL_LANGUAGES: ReadonlyArray<Language> = ["typescript", "javascript", "python", "java"];

interface LanguageProperties {
	language_summary: string;
	lang_typescript: boolean;
	lang_javascript: boolean;
	lang_python: boolean;
	lang_java: boolean;
}

export const buildLanguageProperties = (detected: ReadonlyArray<string>): LanguageProperties => {
	const present = new Set(detected);
	const summary = [...present].filter((l): l is Language => ALL_LANGUAGES.includes(l as Language));
	summary.sort();

	return {
		language_summary: summary.join(","),
		lang_typescript: present.has("typescript"),
		lang_javascript: present.has("javascript"),
		lang_python: present.has("python"),
		lang_java: present.has("java"),
	};
};

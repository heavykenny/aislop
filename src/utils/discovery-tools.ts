import { isToolAvailable } from "./tooling.js";

export const TOOLS_TO_CHECK = [
	"oxlint",
	"biome",
	"ruff",
	"golangci-lint",
	"npm",
	"pnpm",
	"govulncheck",
	"gofmt",
	"pip-audit",
	"cargo",
	"cargo-audit",
	"clippy-driver",
	"rustfmt",
	"rubocop",
	"phpcs",
	"php-cs-fixer",
	"dotnet",
	"roslynator",
	"jb",
	"cppcheck",
	"clang-format",
	"clang-tidy",
];

export const checkInstalledTools = async (): Promise<Record<string, boolean>> => {
	const results: Record<string, boolean> = {};
	await Promise.all(
		TOOLS_TO_CHECK.map(async (tool) => {
			results[tool] = await isToolAvailable(tool);
		}),
	);
	return results;
};

import { execSync } from "node:child_process";
import path from "node:path";

const GITHUB_REMOTE_RE =
	/^(?:git@github\.com:|https:\/\/(?:[^@]+@)?github\.com\/)([^/]+)\/([^/.\s]+?)(?:\.git)?\s*$/;

export interface BadgeOptions {
	owner?: string;
	repo?: string;
	directory?: string;
	json?: boolean;
}

export interface BadgeRenderInput {
	owner: string;
	repo: string;
	svgUrl: string;
	pageUrl: string;
}

export const renderBadgeOutput = ({
	owner,
	repo,
	svgUrl,
	pageUrl,
}: BadgeRenderInput): string => {
	const slug = `${owner}/${repo}`;
	const markdown = `[![aislop](${svgUrl})](${pageUrl})`;
	return [
		``,
		`  Repository:  ${slug}`,
		`  Badge URL:   ${svgUrl}`,
		``,
		`  Markdown:`,
		``,
		`    ${markdown}`,
		``,
		`  Drop the line above into your README. The badge auto-updates after every public scan.`,
		``,
	].join("\n");
};

const detectGithubSlugFromGit = (
	directory: string,
): { owner: string; repo: string } | null => {
	let raw: string;
	try {
		raw = execSync("git remote get-url origin", {
			cwd: path.resolve(directory),
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return null;
	}
	const match = raw.trim().match(GITHUB_REMOTE_RE);
	if (!match) return null;
	const owner = match[1];
	const repo = match[2];
	if (!owner || !repo) return null;
	return { owner, repo };
};

export interface BadgeResult {
	owner: string;
	repo: string;
	svgUrl: string;
	pageUrl: string;
	output: string;
}

export const badgeCommand = async (
	options: BadgeOptions = {},
): Promise<BadgeResult> => {
	let owner = options.owner?.trim();
	let repo = options.repo?.trim();

	if (!owner || !repo) {
		const detected = detectGithubSlugFromGit(options.directory ?? ".");
		if (!detected) {
			throw new Error(
				"Could not detect a GitHub remote. Run from a repo with `git remote get-url origin` set, or pass --owner and --repo.",
			);
		}
		owner ??= detected.owner;
		repo ??= detected.repo;
	}

	const svgUrl = `https://badges.scanaislop.com/score/${owner}/${repo}.svg`;
	const pageUrl = `https://scanaislop.com/${owner}/${repo}`;
	const output = renderBadgeOutput({ owner, repo, svgUrl, pageUrl });

	if (options.json) {
		process.stdout.write(JSON.stringify({ owner, repo, svgUrl, pageUrl }) + "\n");
	} else {
		process.stdout.write(output);
	}

	return { owner, repo, svgUrl, pageUrl, output };
};

#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const README = "README.md";
const OVERRIDES = ".github/contributors-overrides.json";
const START = "<!-- CONTRIBUTORS-START -->";
const END = "<!-- CONTRIBUTORS-END -->";

const isBot = (email) =>
	/\[bot\]@|github-actions|scanaislop\[bot\]|^bot@scanaislop/i.test(email);

const overrides = existsSync(OVERRIDES)
	? JSON.parse(readFileSync(OVERRIDES, "utf8"))
	: {};

const log = execSync(`git log --format="%an<>%ae"`, { encoding: "utf8" }).trim();
const seen = new Map();
for (const line of log.split("\n")) {
	const sep = line.indexOf("<>");
	if (sep < 0) continue;
	const name = line.slice(0, sep);
	const email = line.slice(sep + 2);
	if (!seen.has(email)) seen.set(email, name);
}

const NOREPLY = /^\d+\+([\w-]+)@users\.noreply\.github\.com$/;

async function searchGithub(email) {
	const token = process.env.GITHUB_TOKEN;
	if (!token) return null;
	const res = await fetch(
		`https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`,
		{
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
			},
		},
	);
	if (!res.ok) return null;
	const data = await res.json();
	return data.items?.[0]?.login ?? null;
}

async function resolve(email) {
	const m = email.match(NOREPLY);
	if (m) return m[1];
	if (overrides[email]) return overrides[email];
	return await searchGithub(email);
}

const collected = new Map();
for (const [email, name] of seen) {
	if (isBot(email)) continue;
	const login = await resolve(email);
	if (!login) continue;
	if (!collected.has(login)) collected.set(login, name);
}

if (collected.size === 0) {
	console.error("no contributors resolved — check overrides + token");
	process.exit(1);
}

const lines = [...collected.entries()]
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([login]) => `- [@${login}](https://github.com/${login})`)
	.join("\n");

const text = readFileSync(README, "utf8");
const si = text.indexOf(START);
const ei = text.indexOf(END);
if (si < 0 || ei < 0) {
	console.error("README markers missing");
	process.exit(1);
}
const before = text.slice(0, si + START.length);
const after = text.slice(ei);
const updated = `${before}\n${lines}\n${after}`;

if (updated === text) {
	console.log("no changes");
	process.exit(0);
}

writeFileSync(README, updated);
console.log(`wrote ${collected.size} contributors`);

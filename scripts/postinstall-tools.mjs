#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";
import * as tar from "tar";

const THIS_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(THIS_FILE), "..");
const TOOLS_BIN_DIR = path.join(PACKAGE_ROOT, "tools", "bin");
const USER_AGENT = "aislop-installer";

const PLATFORM_KEY = `${process.platform}-${process.arch}`;

const TOOL_DEFINITIONS = [
	{
		name: "ruff",
		repo: "astral-sh/ruff",
		version: "0.15.4",
		tag: "0.15.4",
		binaryName: "ruff",
		assets: {
			"darwin-arm64": ["ruff-aarch64-apple-darwin.tar.gz"],
			"darwin-x64": ["ruff-x86_64-apple-darwin.tar.gz"],
			"linux-arm64": ["ruff-aarch64-unknown-linux-gnu.tar.gz"],
			"linux-x64": ["ruff-x86_64-unknown-linux-gnu.tar.gz"],
			"win32-arm64": ["ruff-aarch64-pc-windows-msvc.zip"],
			"win32-x64": ["ruff-x86_64-pc-windows-msvc.zip"],
		},
	},
	{
		name: "golangci-lint",
		repo: "golangci/golangci-lint",
		version: "2.10.1",
		tag: "v2.10.1",
		binaryName: "golangci-lint",
		assets: {
			"darwin-arm64": [
				"golangci-lint-2.10.1-darwin-arm64.tar.gz",
				"golangci-lint-v2.10.1-darwin-arm64.tar.gz",
			],
			"darwin-x64": [
				"golangci-lint-2.10.1-darwin-amd64.tar.gz",
				"golangci-lint-v2.10.1-darwin-amd64.tar.gz",
			],
			"linux-arm64": [
				"golangci-lint-2.10.1-linux-arm64.tar.gz",
				"golangci-lint-v2.10.1-linux-arm64.tar.gz",
			],
			"linux-x64": [
				"golangci-lint-2.10.1-linux-amd64.tar.gz",
				"golangci-lint-v2.10.1-linux-amd64.tar.gz",
			],
			"win32-arm64": [
				"golangci-lint-2.10.1-windows-arm64.zip",
				"golangci-lint-v2.10.1-windows-arm64.zip",
			],
			"win32-x64": [
				"golangci-lint-2.10.1-windows-amd64.zip",
				"golangci-lint-v2.10.1-windows-amd64.zip",
			],
		},
	},
];

const isWindows = process.platform === "win32";
const withExecutableExtension = (name) => (isWindows ? `${name}.exe` : name);

const info = (message) => console.log(`[aislop] ${message}`);
const warn = (message) => console.warn(`[aislop] ${message}`);

const downloadFile = async (url, destination) => {
	const response = await fetch(url, {
		headers: { "User-Agent": USER_AGENT },
	});
	if (!response.ok || !response.body) {
		throw new Error(`Failed to download ${url} (${response.status})`);
	}
	await pipeline(
		Readable.fromWeb(response.body),
		fs.createWriteStream(destination),
	);
};

const extractArchive = async (archivePath, extractDir) => {
	if (archivePath.endsWith(".tar.gz")) {
		await tar.x({ file: archivePath, cwd: extractDir });
		return;
	}
	if (archivePath.endsWith(".zip")) {
		const zip = new AdmZip(archivePath);
		zip.extractAllTo(extractDir, true);
		return;
	}
	throw new Error(`Unsupported archive format for ${archivePath}`);
};

const getTagCandidates = (tag) => {
	if (tag.startsWith("v")) {
		return [tag, tag.slice(1)];
	}
	return [tag, `v${tag}`];
};

const getAssetUrls = (tool, assetName) =>
	getTagCandidates(tool.tag).map(
		(tag) =>
			`https://github.com/${tool.repo}/releases/download/${tag}/${assetName}`,
	);

const downloadFromCandidates = async (urls, archivePath) => {
	const failures = [];
	for (const url of urls) {
		try {
			await downloadFile(url, archivePath);
			return url;
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}
	throw new Error(
		`Could not download from candidate URLs: ${failures.join(" | ")}`,
	);
};

const findBinary = (rootDir, binaryName) => {
	const queue = [rootDir];
	while (queue.length > 0) {
		const current = queue.shift();
		if (!current) continue;
		const entries = fs.readdirSync(current, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				queue.push(fullPath);
				continue;
			}
			if (entry.name === binaryName) return fullPath;
		}
	}
	return null;
};

const installTool = async (tool) => {
	const assetNames = tool.assets[PLATFORM_KEY];
	if (!assetNames || assetNames.length === 0) {
		warn(`No bundled ${tool.name} build for ${PLATFORM_KEY}; skipping.`);
		return false;
	}

	const destinationBinary = path.join(
		TOOLS_BIN_DIR,
		withExecutableExtension(tool.binaryName),
	);
	if (fs.existsSync(destinationBinary)) {
		info(`${tool.name} already present.`);
		return true;
	}

	const tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), `aislop-${tool.name}-`),
	);
	const archivePath = path.join(tempDir, assetNames[0]);
	const extractDir = path.join(tempDir, "extract");
	fs.mkdirSync(extractDir, { recursive: true });

	try {
		const candidateUrls = assetNames.flatMap((assetName) =>
			getAssetUrls(tool, assetName),
		);
		info(`Downloading ${tool.name} ${tool.version}...`);
		await downloadFromCandidates(candidateUrls, archivePath);
		await extractArchive(archivePath, extractDir);

		const extractedBinary = findBinary(
			extractDir,
			withExecutableExtension(tool.binaryName),
		);
		if (!extractedBinary) {
			throw new Error(
				`Unable to locate ${tool.binaryName} in extracted archive`,
			);
		}

		fs.mkdirSync(TOOLS_BIN_DIR, { recursive: true });
		fs.copyFileSync(extractedBinary, destinationBinary);
		if (!isWindows) fs.chmodSync(destinationBinary, 0o755);

		info(`Installed bundled ${tool.name} at ${destinationBinary}`);
		return true;
	} finally {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
};

const main = async () => {
	if (process.env.AISLOP_SKIP_TOOL_DOWNLOAD === "1") {
		info("Skipping bundled tool download (AISLOP_SKIP_TOOL_DOWNLOAD=1).");
		return;
	}

	const failures = [];
	for (const tool of TOOL_DEFINITIONS) {
		try {
			const installed = await installTool(tool);
			if (!installed) {
				failures.push(`${tool.name}: unsupported platform`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failures.push(`${tool.name}: ${message}`);
			warn(`Failed to install ${tool.name}: ${message}`);
		}
	}

	if (failures.length > 0) {
		warn("Some bundled tools could not be installed:");
		for (const failure of failures) {
			warn(`  - ${failure}`);
		}
		warn(
			"aislop will still run, but coverage for those tools may be reduced until installation succeeds.",
		);
	}
};

main().catch((error) => {
	warn(
		`postinstall failed: ${error instanceof Error ? error.message : String(error)}`,
	);
});

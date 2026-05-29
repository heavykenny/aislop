import { execFile } from "node:child_process";
import * as vscode from "vscode";

interface AislopDiagnostic {
	filePath: string;
	engine: string;
	rule: string;
	severity: "error" | "warning" | "info";
	message: string;
	line: number;
	column: number;
	fixable: boolean;
}

interface AislopEnvelope {
	schemaVersion: string;
	score: number;
	diagnostics: AislopDiagnostic[];
	summary: {
		errors: number;
		warnings: number;
		fixable: number;
		files: number;
	};
}

interface ScanOutcome {
	envelope: AislopEnvelope;
	stderr: string;
}

class AislopNotInstalledError extends Error {}

const SEVERITY_MAP: Record<AislopDiagnostic["severity"], vscode.DiagnosticSeverity> = {
	error: vscode.DiagnosticSeverity.Error,
	warning: vscode.DiagnosticSeverity.Warning,
	info: vscode.DiagnosticSeverity.Information,
};

const toSeverity = (severity: AislopDiagnostic["severity"]): vscode.DiagnosticSeverity =>
	SEVERITY_MAP[severity] ?? vscode.DiagnosticSeverity.Warning;

const getCliPath = (): string =>
	vscode.workspace.getConfiguration("aislop").get<string>("path", "aislop");

const isMissingBinary = (error: NodeJS.ErrnoException): boolean =>
	error.code === "ENOENT" || /not found|not recognized/i.test(error.message);

const runScan = (target: string, cwd: string): Promise<ScanOutcome> =>
	new Promise((resolve, reject) => {
		execFile(
			getCliPath(),
			["scan", target, "--json"],
			{ cwd, maxBuffer: 16 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error && isMissingBinary(error as NodeJS.ErrnoException)) {
					reject(new AislopNotInstalledError(error.message));
					return;
				}
				if (!stdout.trim()) {
					reject(new Error(stderr.trim() || (error ? error.message : "aislop produced no output")));
					return;
				}
				try {
					const envelope = JSON.parse(stdout) as AislopEnvelope;
					resolve({ envelope, stderr });
				} catch {
					reject(new Error("Failed to parse aislop JSON output"));
				}
			},
		);
	});

const toDiagnostic = (finding: AislopDiagnostic): vscode.Diagnostic => {
	const line = Math.max(0, finding.line - 1);
	const column = Math.max(0, finding.column - 1);
	const range = new vscode.Range(line, column, line, column + 1);
	const diagnostic = new vscode.Diagnostic(range, finding.message, toSeverity(finding.severity));
	diagnostic.source = "aislop";
	diagnostic.code = `${finding.engine}/${finding.rule}`;
	return diagnostic;
};

const publishDiagnostics = (
	collection: vscode.DiagnosticCollection,
	envelope: AislopEnvelope,
	scopedFile?: vscode.Uri,
): void => {
	if (scopedFile) {
		collection.set(scopedFile, envelope.diagnostics.map(toDiagnostic));
		return;
	}
	collection.clear();
	const byFile = new Map<string, vscode.Diagnostic[]>();
	for (const finding of envelope.diagnostics) {
		const existing = byFile.get(finding.filePath) ?? [];
		existing.push(toDiagnostic(finding));
		byFile.set(finding.filePath, existing);
	}
	for (const [filePath, diagnostics] of byFile) {
		collection.set(vscode.Uri.file(filePath), diagnostics);
	}
};

const updateStatusBar = (item: vscode.StatusBarItem, envelope: AislopEnvelope): void => {
	item.text = `$(shield) aislop ${envelope.score}/100`;
	item.tooltip = `${envelope.summary.errors} errors, ${envelope.summary.warnings} warnings (${envelope.summary.fixable} fixable)`;
	item.show();
};

const reportFailure = (error: unknown, status: vscode.StatusBarItem): void => {
	if (error instanceof AislopNotInstalledError) {
		status.text = "$(shield) aislop: not installed";
		status.tooltip = "Install the aislop CLI: npm i -g aislop";
		status.show();
		void vscode.window.showWarningMessage(
			"aislop CLI not found. Install it with `npm i -g aislop` or set `aislop.path`.",
		);
		return;
	}
	const message = error instanceof Error ? error.message : String(error);
	void vscode.window.showErrorMessage(`aislop scan failed: ${message}`);
};

const scan = async (
	target: string,
	cwd: string,
	collection: vscode.DiagnosticCollection,
	status: vscode.StatusBarItem,
	scopedFile?: vscode.Uri,
): Promise<void> => {
	try {
		const { envelope } = await runScan(target, cwd);
		publishDiagnostics(collection, envelope, scopedFile);
		updateStatusBar(status, envelope);
	} catch (error) {
		reportFailure(error, status);
	}
};

const workspaceRoot = (uri?: vscode.Uri): vscode.WorkspaceFolder | undefined => {
	if (uri) {
		const folder = vscode.workspace.getWorkspaceFolder(uri);
		if (folder) {
			return folder;
		}
	}
	return vscode.workspace.workspaceFolders?.[0];
};

export const activate = (context: vscode.ExtensionContext): void => {
	const collection = vscode.languages.createDiagnosticCollection("aislop");
	const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
	status.command = "aislop.scanWorkspace";
	context.subscriptions.push(collection, status);

	const scanWorkspace = (): void => {
		const folder = workspaceRoot();
		if (!folder) {
			void vscode.window.showInformationMessage("aislop: open a folder to scan.");
			return;
		}
		void scan(folder.uri.fsPath, folder.uri.fsPath, collection, status);
	};

	const scanDocument = (document: vscode.TextDocument): void => {
		if (document.uri.scheme !== "file") {
			return;
		}
		const folder = workspaceRoot(document.uri);
		const cwd = folder ? folder.uri.fsPath : document.uri.fsPath;
		void scan(document.uri.fsPath, cwd, collection, status, document.uri);
	};

	context.subscriptions.push(
		vscode.commands.registerCommand("aislop.scanWorkspace", scanWorkspace),
		vscode.workspace.onDidSaveTextDocument((document) => {
			if (vscode.workspace.getConfiguration("aislop").get<boolean>("scanOnSave", true)) {
				scanDocument(document);
			}
		}),
	);

	scanWorkspace();
};

export const deactivate = (): void => {};

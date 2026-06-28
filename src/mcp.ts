import { performance } from "node:perf_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	aislopBaselineInputSchema,
	aislopBaselineTool,
	aislopFixInputSchema,
	aislopFixTool,
	aislopScanInputSchema,
	aislopScanTool,
	aislopWhyInputSchema,
	aislopWhyTool,
	handleAislopBaseline,
	handleAislopFix,
	handleAislopScan,
	handleAislopWhy,
} from "./mcp/tools.js";
import {
	buildMcpToolCalledProps,
	errorKindFromException,
	flushTelemetry,
	track,
} from "./telemetry/index.js";
import { APP_VERSION } from "./version.js";

type ToolName = "aislop_scan" | "aislop_fix" | "aislop_why" | "aislop_baseline";

const ok = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const err = (message: string) => ({
	content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
	isError: true,
});

const instrument = async <T>(tool: ToolName, fn: () => Promise<T> | T) => {
	const startedAt = performance.now();
	try {
		const value = await fn();
		track({
			event: "mcp_tool_called",
			properties: buildMcpToolCalledProps({
				tool,
				durationMs: performance.now() - startedAt,
				ok: true,
			}),
		});
		await flushTelemetry();
		return ok(value);
	} catch (e) {
		track({
			event: "mcp_tool_called",
			properties: buildMcpToolCalledProps({
				tool,
				durationMs: performance.now() - startedAt,
				ok: false,
				errorKind: errorKindFromException(e),
			}),
		});
		await flushTelemetry();
		const msg = e instanceof Error ? e.message : String(e);
		return err(msg);
	}
};

export const buildServer = (): McpServer => {
	const server = new McpServer({
		name: "aislop",
		version: APP_VERSION,
	});

	server.registerTool(
		aislopScanTool.name,
		{
			description: aislopScanTool.description,
			inputSchema: aislopScanInputSchema.shape,
		},
		(input) => instrument("aislop_scan", () => handleAislopScan(input)),
	);

	server.registerTool(
		aislopFixTool.name,
		{
			description: aislopFixTool.description,
			inputSchema: aislopFixInputSchema.shape,
		},
		(input) => instrument("aislop_fix", () => handleAislopFix(input)),
	);

	server.registerTool(
		aislopWhyTool.name,
		{
			description: aislopWhyTool.description,
			inputSchema: aislopWhyInputSchema.shape,
		},
		(input) => instrument("aislop_why", () => handleAislopWhy(input)),
	);

	server.registerTool(
		aislopBaselineTool.name,
		{
			description: aislopBaselineTool.description,
			inputSchema: aislopBaselineInputSchema.shape,
		},
		(input) => instrument("aislop_baseline", () => handleAislopBaseline(input)),
	);

	return server;
};

const main = async (): Promise<void> => {
	const server = buildServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
	track({ event: "mcp_server_started" });
	await flushTelemetry();
};

main().catch((e) => {
	process.stderr.write(
		`aislop-mcp failed to start: ${e instanceof Error ? e.message : String(e)}\n`,
	);
	process.exit(1);
});

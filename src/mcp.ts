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
import { APP_VERSION } from "./version.js";

const ok = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const err = (message: string) => ({
	content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
	isError: true,
});

const tryHandle = async <T>(fn: () => Promise<T> | T) => {
	try {
		return ok(await fn());
	} catch (e) {
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
		(input) => tryHandle(() => handleAislopScan(input)),
	);

	server.registerTool(
		aislopFixTool.name,
		{
			description: aislopFixTool.description,
			inputSchema: aislopFixInputSchema.shape,
		},
		(input) => tryHandle(() => handleAislopFix(input)),
	);

	server.registerTool(
		aislopWhyTool.name,
		{
			description: aislopWhyTool.description,
			inputSchema: aislopWhyInputSchema.shape,
		},
		(input) => tryHandle(() => handleAislopWhy(input)),
	);

	server.registerTool(
		aislopBaselineTool.name,
		{
			description: aislopBaselineTool.description,
			inputSchema: aislopBaselineInputSchema.shape,
		},
		(input) => tryHandle(() => handleAislopBaseline(input)),
	);

	return server;
};

const main = async (): Promise<void> => {
	const server = buildServer();
	const transport = new StdioServerTransport();
	await server.connect(transport);
};

main().catch((e) => {
	process.stderr.write(
		`aislop-mcp failed to start: ${e instanceof Error ? e.message : String(e)}\n`,
	);
	process.exit(1);
});

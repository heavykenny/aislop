import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanSecrets } from "../src/engines/security/secrets.js";
import type { EngineContext } from "../src/engines/types.js";

let tmpDir: string;

const writeFile = (relative: string, content: string): void => {
	const absolute = path.join(tmpDir, relative);
	fs.mkdirSync(path.dirname(absolute), { recursive: true });
	fs.writeFileSync(absolute, content);
};

const buildContext = (): EngineContext => ({
	rootDirectory: tmpDir,
	languages: ["typescript"],
	frameworks: [],
	installedTools: {},
	config: {
		quality: { maxFunctionLoc: 80, maxFileLoc: 400, maxNesting: 5, maxParams: 6 },
		security: { audit: false, auditTimeout: 0 },
		lint: { typecheck: false },
	},
});

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aislop-secrets-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("scanSecrets", () => {
	it("flags a hardcoded password in real code", async () => {
		writeFile("src/config.ts", `export const config = { password: "s3cr3tValue99" }\n`);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].rule).toBe("security/hardcoded-secret");
		expect(diagnostics[0].severity).toBe("error");
	});

	it("does not flag public PostHog project tokens but still flags personal API keys", async () => {
		writeFile(
			"internal/telemetry/telemetry.go",
			[
				`package telemetry`,
				`const postHogAPIKey = "phc_FAKEPUBLICTOKEN01234567890123456"`,
				`const postHogPersonalAPIKey = "phx_FAKEPERSONALKEY0123456789012345"`,
				``,
			].join("\n"),
		);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("API key");
	});

	it("does not flag passwords generated from secure randomness", async () => {
		writeFile(
			"app/builders/agent_builder.rb",
			`temp_password = "1!aA#{SecureRandom.alphanumeric(12)}"\n`,
		);
		writeFile(
			"app/controllers/oauth.rb",
			`resource.update(password: "#{SecureRandom.hex(16)}aA1!")\n`,
		);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag fixture passwords in seed and test-support paths", async () => {
		writeFile("db/seeds.rb", `user = User.new(password: 'Password1!')\n`);
		writeFile("lib/seeders/account_seeder.rb", `password: 'Password1!.'\n`);
		writeFile(
			"server/channels/app/slashcommands/auto_constants.go",
			[
				`const UserPassword = "Usr@MMTest12345"`,
				`const BTestUserPassword = "Passwd+Us3r1234"`,
				`connection.ClientSecret = "Updated ClientSecret"`,
				``,
			].join("\n"),
		);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag masked fake secrets used for display placeholders", async () => {
		writeFile(
			"webapp/components/installed_oauth_app.tsx",
			`const FAKE_SECRET = '***************';\n`,
		);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag localhost database URLs in e2e/test config", async () => {
		writeFile(
			"e2e-tests/cypress/cypress.config.ts",
			`dbConnection: 'postgres://mmuser:mostest@localhost/mattermost_test?sslmode=disable'\n`,
		);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag localhost sample database URLs in Go command examples or defaults", async () => {
		writeFile(
			"server/cmd/mmctl/commands/config.go",
			[
				`package commands`,
				`var configCmd = Command{`,
				`\tExample: \`config migrate path/to/config.json "postgres://mmuser:mostest@localhost:5432/mattermost_test?sslmode=disable&connect_timeout=10"\`,`,
				`}`,
				``,
			].join("\n"),
		);
		writeFile(
			"server/public/model/config.go",
			[
				`package model`,
				`const SqlSettingsDefaultDataSource = "postgres://mmuser:mostest@localhost/mattermost_test?sslmode=disable&connect_timeout=10"`,
				`// "postgres://user:pass@host:5432/db" -> "postgres://****:****@host:5432/db"`,
				``,
			].join("\n"),
		);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("still flags production database URLs with credentials", async () => {
		writeFile("src/config.ts", `export const dsn = "postgres://app:supersecret123@db.internal/app"\n`);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].message).toContain("Database connection string");
	});

	it("does not flag symbolic permission and audit-event constants as secrets", async () => {
		writeFile(
			"server/public/model/audit_events.go",
			[
				`const AuditEventCreateUserAccessToken = "createUserAccessToken"`,
				`const AuditEventResetPassword = "resetPassword"`,
				`const AuditEventRegenOutgoingHookToken = "regenOutgoingHookToken"`,
				``,
			].join("\n"),
		);
		writeFile(
			"webapp/channels/src/constants/permissions.ts",
			[
				`export const Permissions = {`,
				`  CREATE_USER_ACCESS_TOKEN: 'create_user_access_token',`,
				`  SYSCONSOLE_READ_AUTHENTICATION_PASSWORD: 'sysconsole_read_authentication_password',`,
				`  PASSWORD: 'authentication.password',`,
				`  API_USER_INVALID_PASSWORD: 'api.user.check_user_password.invalid.app_error',`,
				`};`,
				``,
			].join("\n"),
		);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag HTTP header-name constants as token secrets", async () => {
		writeFile(
			"server/public/model/client4.go",
			[
				`const HeaderToken = "token"`,
				`const HeaderCloudToken = "X-Cloud-Token"`,
				`const HeaderAuth = "Authorization"`,
				``,
			].join("\n"),
		);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag the same secret inside a JSDoc @example", async () => {
		writeFile(
			"src/usage.ts",
			`/**\n * @example\n * const config = { password: "s3cr3tValue99" }\n */\nexport const handler = () => null\n`,
		);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("does not flag pure environment placeholders in config files", async () => {
		writeFile("deploy.yml", `database:\n  password: "\${DB_PASSWORD}"\n`);
		writeFile("settings.toml", `secret = "\${APP_SECRET}"\n`);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toEqual([]);
	});

	it("still flags mixed strings that contain an environment placeholder", async () => {
		writeFile("deploy.yml", `secret: "prod-\${tenant}-secret"\n`);

		const diagnostics = await scanSecrets(buildContext());

		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0].rule).toBe("security/hardcoded-secret");
	});
});

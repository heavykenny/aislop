import { CPP_SOURCE_EXTENSIONS } from "../cpp-targets.js";

export interface RiskyPattern {
	pattern: RegExp;
	extensions: string[];
	name: string;
	message: string;
	help: string;
}

// Build patterns using string concatenation to avoid self-detection
const ev = "ev" + "al";
const Fn = "Func" + "tion";

const DB_RECEIVER =
	"(?:db|database|knex|client|connection|conn|pool|sql|prisma|trx|tx|sequelize|mongoose|typeorm|postgres|pg|mysql|sqlite|model|orm|datasource)";
const DB_METHOD =
	"(?:query|execute|exec|raw|\\$queryRaw|\\$queryRawUnsafe|\\$executeRaw|\\$executeRawUnsafe)";

const CPP_EXTS = [...CPP_SOURCE_EXTENSIONS];

// C# string-building SQL sinks (ADO.NET command types/CommandText and EF Core's
// *Raw* helpers). The parameter-safe EF Core `FromSqlInterpolated` /
// `ExecuteSqlInterpolated` are deliberately excluded.
const CS_SQL_SINK =
	"(?:SqlCommand|MySqlCommand|NpgsqlCommand|SqliteCommand|OleDbCommand|OracleCommand|SqlDataAdapter|CommandText|FromSqlRaw|FromSqlRawAsync|ExecuteSqlRaw|ExecuteSqlRawAsync|ExecuteSqlCommand)";
// An interpolated string opener: `$"`, `$@"`, or `@$"`. After masking the body
// is blanked but the `$`/`@` prefix and the opening quote survive.
const CS_INTERP = '(?:\\$@?|@\\$)"';
// A masked, plain (non-interpolated) string literal immediately concatenated
// with `+`, e.g. `"...LIKE " + name`. Shared by the SQL and command sinks below.
const CS_CONCAT = '@?"[^"]*"\\s*\\+';
const CS_CMD_SINK = "(?:\\bProcess\\.Start\\s*\\(|\\.Arguments\\s*=)";

const csharpRisk = (
	pattern: RegExp,
	name: string,
	message: string,
	help: string,
): RiskyPattern => ({ pattern, extensions: [".cs"], name, message, help });

export const RISKY_PATTERNS: RiskyPattern[] = [
	{
		// Negative lookbehind skips method-call forms (`.eval(`, `->eval(`, `::eval(`, `\eval(`)
		// which are not the global eval — common in PHP (Redis Lua), Ruby (binding.eval), JS (custom methods).
		pattern: new RegExp(`(?<![\\w.>:\\\\])\\b${ev}\\s*\\(`, "g"),
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".php"],
		name: "eval",
		message: `Use of ${ev}() is a security risk`,
		help: `Avoid ${ev} — use safer alternatives like JSON.parse, Function constructor, or AST-based approaches`,
	},
	{
		pattern: new RegExp(`new\\s+${Fn}\\s*\\(`, "g"),
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		name: "new-function",
		message: `Use of new ${Fn}() is similar to ${ev} and can be a security risk`,
		help: "Avoid dynamic code execution — refactor to use static code paths",
	},
	{
		pattern: new RegExp(`\\.inner${""}HTML\\s*=`, "g"),
		extensions: [".ts", ".tsx", ".js", ".jsx"],
		name: "innerhtml",
		message: "Direct innerHTML assignment can lead to XSS",
		help: "Use textContent, DOM APIs, or a sanitization library instead",
	},
	{
		pattern: /dangerouslySetInnerHTML/g,
		extensions: [".tsx", ".jsx"],
		name: "dangerously-set-innerhtml",
		message: "dangerouslySetInnerHTML can lead to XSS if not sanitized",
		help: "Ensure the HTML is sanitized with DOMPurify or similar before rendering",
	},
	{
		pattern: /pickle\.loads?\s*\(/g,
		extensions: [".py"],
		name: "pickle-load",
		message: "pickle.load can execute arbitrary code — unsafe deserialization",
		help: "Use JSON, MessagePack, or other safe serialization formats for untrusted data",
	},
	{
		// Negative lookbehind skips method-call forms (`.exec(`, `->exec(`, `::exec(`, `\exec(`)
		// which are not the builtin exec — e.g. SQLModel's session.exec(stmt) or RegExp.exec.
		pattern: new RegExp(`(?<![\\w.>:\\\\])\\b${"ex" + "ec"}\\s*\\(`, "g"),
		extensions: [".py"],
		name: "python-exec",
		message: "Use of exec() can execute arbitrary code",
		help: "Avoid exec — use safer alternatives",
	},
	{
		pattern: /(?:child_process|subprocess|os\.system|exec|spawn)\s*\([^)]*\$\{/g,
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"],
		name: "shell-injection",
		message: "Possible shell injection — user input in command execution",
		help: "Use parameterized commands or a safe shell execution library",
	},
	{
		pattern: new RegExp(
			`\\b${DB_RECEIVER}(?:\\.\\w+)*\\.${DB_METHOD}\\s*\\(?\\s*\`[^\`]*\\$\\{`,
			"g",
		),
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		name: "sql-injection",
		message: "Possible SQL injection — template literal in query",
		help: "Use parameterized queries or an ORM instead of string interpolation",
	},
	{
		pattern: new RegExp(
			`\\b${DB_RECEIVER}(?:\\.\\w+)*\\.${DB_METHOD}\\s*\\(\\s*["'][^"']*["']\\s*\\+`,
			"g",
		),
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
		name: "sql-injection",
		message: "Possible SQL injection — string concatenation in query",
		help: "Use parameterized queries or an ORM instead of string concatenation",
	},
	csharpRisk(
		new RegExp(`\\b${CS_SQL_SINK}\\b\\s*[(=]\\s*${CS_INTERP}`, "g"),
		"sql-injection",
		"Possible SQL injection: interpolated string in query",
		"Use parameterized queries (SqlParameter) or EF Core FromSqlInterpolated/ExecuteSqlInterpolated",
	),
	csharpRisk(
		new RegExp(`\\b${CS_SQL_SINK}\\b\\s*[(=]\\s*${CS_CONCAT}`, "g"),
		"sql-injection",
		"Possible SQL injection: string concatenation in query",
		"Use parameterized queries (SqlParameter) instead of string concatenation",
	),
	csharpRisk(
		new RegExp(`${CS_CMD_SINK}\\s*${CS_INTERP}`, "g"),
		"shell-injection",
		"Possible command injection: interpolated string in process invocation",
		"Pass arguments as a ProcessStartInfo.ArgumentList collection, not an interpolated command string",
	),
	csharpRisk(
		new RegExp(`${CS_CMD_SINK}\\s*${CS_CONCAT}`, "g"),
		"shell-injection",
		"Possible command injection: string concatenation in process invocation",
		"Pass arguments as a ProcessStartInfo.ArgumentList collection, not a concatenated command string",
	),
	{
		pattern:
			/\b(?:BinaryFormatter|NetDataContractSerializer|SoapFormatter|LosFormatter|ObjectStateFormatter)\b/g,
		extensions: [".cs"],
		name: "unsafe-deserialization",
		message: "Unsafe deserializer can execute arbitrary code on untrusted input",
		help: "Use System.Text.Json or DataContractSerializer with a known, restricted set of types",
	},
	{
		// Negative lookbehind skips member access (`.system`, `->system`) but keeps
		// the qualified `std::system`, which is the same dangerous call.
		pattern: /(?<![\w.>])\b(?:system|popen)\s*\(/g,
		extensions: CPP_EXTS,
		name: "shell-injection",
		message: "Use of system()/popen() spawns a shell - a command-injection risk",
		help: "Use posix_spawn/exec-family with an explicit argument vector, or a vetted process library",
	},
	{
		pattern: /(?<![\w.>])\b(?:gets|strcpy|strcat|sprintf)\s*\(/g,
		extensions: CPP_EXTS,
		name: "unsafe-c-call",
		message: "Memory-unsafe C string function - buffer overflow risk",
		help: "Use bounded variants (snprintf, strncpy/strncat, fgets) or std::string / std::format",
	},
];

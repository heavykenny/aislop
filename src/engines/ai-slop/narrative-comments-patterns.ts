export const DECORATIVE_SEPARATOR = /^[-=─━~_*#]{6,}$/;
export const DECORATIVE_SECTION_HEADER = /^[-=─━~_*#]{3,}[\s\S]+?[-=─━~_*#]{3,}$/;
export const SECTION_HEADER = /^(Phase|Step|Section|Part)\s+\d+[:.-]/i;

export const CROSS_REFERENCE_PHRASES = [
	/\bwill then be\b/i,
	/\bused by\b/i,
	/\bcalled from\b/i,
	/\bcalled later\b/i,
	/\bsee (?:above|below|later|earlier)\b/i,
	/\breplaces the\b/i,
	/\bmatches the one\b/i,
	/\bwe moved\b/i,
	/\bwe used to\b/i,
	/\brefactor(?:ed)? from\b/i,
	/\bcombined with\b.*\bthis\b/i,
];

export const JUSTIFICATION_OPENERS = [
	/^(The idea here|The trick is|This was needed|Originally,?)/i,
	// Canonical AI-style narration that restates what the code does.
	/^This\s+(?:function|method|class|module|component|hook|util|helper|handler|service)\b/i,
	/^It\s+(?:does|handles|takes|returns|processes|reads|writes|sends|fetches|loads|creates|deletes|updates|parses|validates)\b/i,
	// Step-by-step narration: "First it ...", "Then it ...", "Finally we ..."
	/^(?:First|Then|Finally|Next|Lastly|Subsequently),?\s+(?:it|we|the\s+(?:function|method|class))\b/i,
];

export const EXPLANATORY_OPENERS =
	/^(Matches|Detects|Represents|Holds|Stores|Tracks|Handles|Manages|Controls|Contains|Captures|Encapsulates|Wraps|Describes)\s+[A-Za-z`'"]/;

export const EXPLANATORY_WHY_MARKERS =
	/\b(?:because|since|otherwise|workaround|caveat|warning|important|assumes?|note:|bug|issue|see\s+(?:issue|above|below)|in\s+prod|in\s+production|breaks?\s+when|fails?\s+when|must\s+run|must\s+be|has\s+to\s+be|hack\s+for|fix\s+for|reason:|to\s+avoid|to\s+ensure|to\s+prevent|in\s+order\s+to|necessary|guarantee[sd]?|prevents?|regardless\s+of|required\s+(?:for|to|by)|for\s+example|e\.g\.|i\.e\.|useful\s+(?:for|when)|intended\s+to|on\s+purpose|by\s+design|ideally|however|although|even\s+though|despite|whereas|unfortunately|trade-?off|first\s+need)\b/i;

export const MEANINGFUL_JSDOC_TAGS = new Set([
	"deprecated",
	"see",
	"example",
	"type",
	"returns",
	"return",
	"param",
	"throws",
	"typedef",
	"callback",
	"override",
	"template",
	"internal",
	"public",
	"private",
	"protected",
	"experimental",
	"alpha",
	"beta",
	"since",
	"todo",
	"link",
	"license",
	"preserve",
	"swagger",
	"openapi",
	"route",
	"group",
	"summary",
	"description",
	"operationid",
	"response",
	"responses",
	"request",
	"requestbody",
	"security",
	"tag",
	"tags",
	"path",
	"body",
	"query",
	"queryparam",
	"header",
	"headers",
	"produces",
	"accept",
	"middleware",
	"api",
	"apiname",
	"apidefine",
	"apigroup",
	"apiparam",
	"apiquery",
	"apibody",
	"apiheader",
	"apisuccess",
	"apierror",
	"apiexample",
	"apiversion",
	"apidescription",
	"apipermission",
	"apiuse",
	"apiignore",
	"apiprivate",
	"namespace",
	"category",
]);

export const SUPPORTED_EXTS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".go",
	".rs",
	".rb",
	".java",
	".php",
]);

export const DECL_START =
	/^(\s*)(export\s+)?(async\s+)?(const|let|var|function|class|type|interface|enum|abstract\s+class)\s+/;
export const EXPORT_DEFAULT = /^\s*export\s+default\b/;
export const TS_MEMBER_DECL_START =
	/^\s*(?:readonly\s+|static\s+|public\s+|private\s+|protected\s+|abstract\s+|override\s+)*[\w$]+\??\s*:/;
export const PY_DECL_START = /^\s*(async\s+def|def|class)\s+/;
export const GO_DECL_START = /^\s*(func|type|var|const|import)\b/;
export const RUST_DECL_START =
	/^\s*(pub\s+)?(async\s+)?(fn|struct|enum|trait|impl|const|static|type|mod)\s+/;
export const RUBY_DECL_START = /^\s*(class|module|def)\s+/;
export const JAVA_DECL_START =
	/^\s*(?:public|private|protected|static|final|abstract|sealed|non-sealed|\s)+(?:class|interface|enum|record|@interface|\w[^(){};=]*\s+\w+\s*\()/;
export const JAVA_DECL_START_FALLBACK = /^\s*(class|interface|enum|record|@interface)\s+/;
export const PHP_DECL_START =
	/^\s*(?:(?:public|private|protected|static|final|abstract|readonly)\s+)*(function|class|interface|trait|enum|const)\s+/;

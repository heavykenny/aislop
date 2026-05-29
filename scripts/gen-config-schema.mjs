#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";
import { AislopConfigSchema } from "../src/config/schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "schema", "aislop.config.schema.json");

// Strip `required`/`additionalProperties:false` so partial user configs (every
// key has a default) validate, and allow the loader-handled `extends` key.
const relax = (node) => {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const item of node) relax(item);
		return;
	}
	delete node.required;
	if (node.additionalProperties === false) delete node.additionalProperties;
	for (const value of Object.values(node)) relax(value);
};

const jsonSchema = z.toJSONSchema(AislopConfigSchema, { target: "draft-2020-12" });
relax(jsonSchema);
jsonSchema.$id = "https://scanaislop.com/schema/aislop.config.schema.json";
jsonSchema.title = "aislop configuration (.aislop/config.yml)";
jsonSchema.description = "Configuration schema for the aislop code-quality CLI.";
jsonSchema.properties.extends = {
	type: "string",
	description: "Path to a parent .aislop config to extend.",
};

writeFileSync(outPath, `${JSON.stringify(jsonSchema, null, "\t")}\n`);
process.stdout.write(`Wrote ${outPath}\n`);

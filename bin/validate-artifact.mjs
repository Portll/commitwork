#!/usr/bin/env node
// Validate a JSON artifact against a declared schema. Exit 0 valid, 1 invalid, 2 unusable input.
//
// WHY A SHARED CLI RATHER THAN A CHECK IN EACH PRODUCER. Two of the three unschema'd artifacts in
// this tree are written by SHELL scripts that hand-build JSON strings, so they cannot call
// validateAgainstSchema directly. The alternative was a second validator per producer, which is the
// duplicate-implementation class this repo has already been bitten by four times in one week — so
// this wraps monitor/registry.mjs's validator rather than reimplementing it.
//
//   node bin/validate-artifact.mjs <schema-name> <artifact.json>
//
// Fails closed at every step: an unreadable artifact, an unparseable one, and an unreadable SCHEMA
// are all non-zero. "Could not check" must never exit 0, or the producer publishes on a check that
// never ran — which is the shape the schemas exist to close in the first place.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateAgainstSchema } from '../monitor/registry.mjs';
import { fileURLToPath } from 'node:url';

const SCHEMA_DIR = () => process.env.CW_SCHEMA_DIR
  || join(resolve(fileURLToPath(new URL('..', import.meta.url))), 'schema');

const [name, artifactPath] = process.argv.slice(2);
if (!name || !artifactPath) {
  console.error('usage: validate-artifact.mjs <schema-name> <artifact.json>');
  process.exit(2);
}

let doc;
try { doc = JSON.parse(readFileSync(artifactPath, 'utf8')); }
catch (e) {
  console.error(`validate-artifact: ${artifactPath} unreadable or not JSON (${e.message})`);
  process.exit(2);
}

const schemaPath = join(SCHEMA_DIR(), `${name}.schema.json`);
const { errors } = validateAgainstSchema(doc, { path: schemaPath });
if (errors.length) {
  console.error(`validate-artifact: ${artifactPath} does not match ${name}.schema.json:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

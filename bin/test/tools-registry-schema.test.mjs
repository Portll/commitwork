// manifests/security-tools.json must satisfy the schema it has always claimed.
//
// It declared `$schema: ../schema/tools.schema.json` for its whole life against a file that did not
// exist. Nothing validated it, and the pointer's presence is precisely what stops a reader looking —
// a dangling `$schema` is worse than none, because it reads as evidence of a check.
//
// The registry carries `run` strings that become commands, so a malformed entry is not cosmetic.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from '../../monitor/registry.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DOC = join(ROOT, 'manifests', 'security-tools.json');
const SCHEMA = join(ROOT, 'schema', 'tools.schema.json');
const doc = JSON.parse(readFileSync(DOC, 'utf8'));

describe('security-tools registry', () => {
  test('the schema it points at EXISTS — a dangling $schema is worse than none', () => {
    // This is the assertion that was missing. The pointer was there; the target was not.
    const declared = String(doc.$schema || '');
    assert.ok(declared, 'the registry must declare the schema it is held to');
    const resolved = join(ROOT, 'manifests', declared);
    assert.ok(existsSync(resolved), `${declared} resolves to ${resolved}, which does not exist`);
  });

  test('the live registry satisfies it', () => {
    const { errors } = validateAgainstSchema(doc, { path: SCHEMA });
    assert.deepEqual(errors, [], `security-tools.json violates its own schema:\n  ${errors.join('\n  ')}`);
  });

  test('every gate a tool names is DEFINED — an unresolvable gate never runs and never says why', () => {
    const known = new Set(Object.keys(doc.gates || {}));
    const dangling = [];
    for (const t of doc.tools) for (const g of String(t.gate).split('+')) if (!known.has(g)) dangling.push(`${t.id} -> ${g}`);
    assert.deepEqual(dangling, [], `gates named by a tool but never defined: ${dangling.join(', ')}`);
  });

  test('every dependsOn resolves to a tool in this registry', () => {
    const ids = new Set(doc.tools.map((t) => t.id));
    const dangling = [];
    for (const t of doc.tools) for (const d of t.dependsOn || []) if (!ids.has(d)) dangling.push(`${t.id} -> ${d}`);
    assert.deepEqual(dangling, [], `dependsOn pointing at unknown tools: ${dangling.join(', ')}`);
  });

  test('the schema REFUSES a malformed entry — a validator that cannot fail is not one', () => {
    // The negative control. A schema is only worth wiring if it rejects something; asserting only
    // that the live file passes would leave a permissive schema green forever.
    const broken = structuredClone(doc);
    delete broken.tools[0].run;
    const { errors } = validateAgainstSchema(broken, { path: SCHEMA });
    assert.ok(errors.length, 'a tool with no `run` must be refused — every field is required because every field was present');
  });

  test('the schema refuses an id that could escape the report tree', () => {
    const broken = structuredClone(doc);
    broken.tools[0].id = '../evil';
    const { errors } = validateAgainstSchema(broken, { path: SCHEMA });
    assert.ok(errors.length, 'an id reaching the filesystem is constrained at the source, not sanitised downstream');
  });
});

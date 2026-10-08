// The manifest schema must not drift behind the code it describes.
//
// Measured 2026-08-25: `report.format`'s enum was ELEVEN formats behind what bin/commitwork.mjs
// actually parses (a11y, actionlint, authz-bola, cspm-github, depscan, gradle-wrapper, minify,
// schemathesis, scorecard, shellcheck, tls-headers), and two check keys in daily use — scopeNotes
// on 17 checks, aliasOf on 2 — were unknown to it entirely.
//
// None of that was tolerated. It was INVISIBLE: nothing validated any manifest against this schema,
// so a manifest could declare a format the schema rejected and a schema could reject a format the
// runner handled, indefinitely, with no symptom. Two descriptions of one contract, only one of
// which executed.
//
// This is the ratchet rather than a re-derivation: the schema stays a checked-in artifact (it is
// read by tooling that has no business importing the runner), and this test fails the moment the
// two disagree in either direction. Direction matters — a schema AHEAD of the code is a manifest
// author being promised a format that will not parse.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARSED_FORMATS, PASSTHROUGH_FORMATS } from '../commitwork.mjs';
import { validateAgainstSchema } from '../../monitor/registry.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCHEMA_PATH = join(ROOT, 'schema', 'manifest.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

const schemaFormats = schema.properties.checks.items.properties.report.properties.format.enum || [];
const codeFormats = [...new Set([...PARSED_FORMATS, ...PASSTHROUGH_FORMATS])].sort();

// Which manifests are actually manifests. A file in manifests/ is not necessarily one — the tool
// registry lives there under its own schema, and two catalogues carry no schema at all. Bind by
// DECLARATION or by the shape the schema requires, never by directory.
const manifestFiles = readdirSync(join(ROOT, 'manifests'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ f, doc: JSON.parse(readFileSync(join(ROOT, 'manifests', f), 'utf8')) }))
  .filter(({ doc }) => Array.isArray(doc.checks) && typeof doc.repo === 'string');

describe('manifest schema vs the code it describes', () => {
  test('the format enum is exactly what the runner can parse — neither behind nor ahead', () => {
    const missing = codeFormats.filter((x) => !schemaFormats.includes(x));
    const extra = schemaFormats.filter((x) => !codeFormats.includes(x));
    assert.deepEqual(missing, [],
      `the schema REJECTS formats the runner handles: ${missing.join(', ')} — a manifest using one is refused for no reason`);
    assert.deepEqual(extra, [],
      `the schema PERMITS formats the runner cannot parse: ${extra.join(', ')} — a manifest author is promised a lane that will silently produce nothing`);
  });

  test('every real manifest satisfies the schema', () => {
    assert.ok(manifestFiles.length >= 4, `expected the known manifests, found ${manifestFiles.length}`);
    const bad = [];
    for (const { f, doc } of manifestFiles) {
      const { errors } = validateAgainstSchema(doc, { path: SCHEMA_PATH });
      if (errors.length) bad.push(`${f}: ${errors[0]}`);
    }
    assert.deepEqual(bad, [], `manifests violating their own schema:\n  ${bad.join('\n  ')}`);
  });

  test('every check key in use is KNOWN to the schema', () => {
    // The scopeNotes/aliasOf case: a key used by 17 checks that the schema had never heard of.
    // additionalProperties:false means the schema was rejecting the live manifest all along, and
    // nobody found out because nobody ran it.
    const known = new Set(Object.keys(schema.properties.checks.items.properties || {}));
    const unknown = new Map();
    for (const { doc } of manifestFiles) {
      for (const c of doc.checks) for (const k of Object.keys(c)) if (!known.has(k)) unknown.set(k, (unknown.get(k) || 0) + 1);
    }
    assert.deepEqual([...unknown.keys()], [],
      `check keys in use but unknown to the schema: ${[...unknown].map(([k, n]) => `${k} (${n})`).join(', ')}`);
  });

  test('the schema REFUSES an unparseable format — a permissive enum proves nothing', () => {
    // Negative control. Asserting only that the live manifests pass would leave an enum of
    // {"type":"string"} green forever.
    const doc = structuredClone(manifestFiles[0].doc);
    doc.checks[0].report = { file: 'x.json', format: 'a-format-nothing-parses' };
    const { errors } = validateAgainstSchema(doc, { path: SCHEMA_PATH });
    assert.ok(errors.length, 'an unknown report format must be refused at the schema, not discovered at runtime');
  });
});

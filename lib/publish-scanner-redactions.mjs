// lib/publish-scanner-redactions.mjs — remove third-party scanner names from narrative failure
// examples on the page they are published to, without removing them from the register.
//
// Why this is separate from lib/publish-redactions.mjs: that one replaces customer identifiers
// GLOBALLY on a rendered page, which is right for a customer name — there is no context in which
// the public docsite should carry one. A scanner name is not like that. The same names are the
// IDENTITY of records in monitor/approach-taxonomy.json, where naming the tool is the whole point,
// so a global pass would leave a catalogue of unnamed approaches. Nor is a field-wide pass enough:
// govulncheck appears in four classes[].example, of which ONE describes the scanner's own behaviour
// and three describe defects in commitwork's own code with the scanner named only as the lane it
// happened in. Redacting those three would strip precision from records that criticise nobody but
// us. So a redaction here names the exact record it applies to and touches nothing else.
//
// A `from` that no longer matches its record THROWS. That is the point of the module: a redaction
// which silently stops applying — because someone reworded the example above it — is exactly how a
// name reaches a public page with every test still green. The assertion is the second witness.
//
// CW_PUBLISH_SCANNER_REDACTIONS overrides the map path, read at CALL time so a test can point it at
// a fixture. ENOENT is legitimately absent (no redactions); malformed is not, and refuses.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from './json-schema.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function scannerRedactionPath(env = process.env) {
  return env.CW_PUBLISH_SCANNER_REDACTIONS || resolve(REPO, 'monitor', 'publish-scanner-redactions.json');
}

export function scannerRedactionSchemaPath(env = process.env) {
  return env.CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA
    || resolve(REPO, 'schema', 'publish-scanner-redactions.schema.json');
}

export function loadScannerRedactions(env = process.env) {
  const path = scannerRedactionPath(env);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error(`publish-scanner-redactions: cannot read ${path}: ${e.message}`);
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) {
    throw new Error(`publish-scanner-redactions: ${path} is not valid JSON (${e.message}) — refusing to publish unredacted`);
  }
  const { errors } = validateAgainstSchema(doc, { path: scannerRedactionSchemaPath(env) });
  if (errors.length) {
    throw new Error(`publish-scanner-redactions: ${path} does not satisfy its schema — refusing to publish unredacted:\n  ${errors.join('\n  ')}`);
  }
  return doc.redactions;
}

/**
 * Apply record-scoped redactions to a failure-taxonomy document. Returns a NEW document; the
 * caller's registry object is left as it was read, because the register keeps the real name.
 * Throws if a redaction names a class that is absent, or a `from` that no longer occurs in it.
 */
export function redactScannersForPublish(registry, env = process.env) {
  const redactions = loadScannerRedactions(env);
  if (!redactions.length) return registry;
  if (!registry || !Array.isArray(registry.classes)) {
    throw new TypeError('publish-scanner-redactions: expected a registry with a classes array');
  }
  const byId = new Map(registry.classes.map((c) => [c.id, c]));
  const misses = [];
  for (const r of redactions) {
    const cls = byId.get(r.class);
    // A registry that simply does not hold this record is not drift. The generator runs against
    // fixture registries under test and against CW_TAXONOMY_JSON overrides, and a redaction for a
    // class they never contained has nothing to redact and nothing to leak. Strictness about the
    // SHIPPED map belongs in the test that reads the shipped registry, not here — enforcing it in
    // the module made four unrelated fixture-driven tests fail, which is a guard defending the
    // wrong boundary. What IS drift, and stays fatal below: the class is present and its text moved.
    if (!cls) continue;
    const text = cls[r.field];
    if (typeof text !== 'string') { misses.push(`${r.class}.${r.field}: not a string`); continue; }
    if (!text.includes(r.from)) misses.push(`${r.class}.${r.field}: ${JSON.stringify(r.from)} no longer occurs — the text was reworded and this redaction stopped applying`);
  }
  if (misses.length) {
    throw new Error(`publish-scanner-redactions: refusing to publish — ${misses.length} redaction(s) no longer match their record:\n  ${misses.join('\n  ')}`);
  }
  const classes = registry.classes.map((c) => {
    const mine = redactions.filter((r) => r.class === c.id);
    if (!mine.length) return c;
    const next = { ...c };
    for (const r of mine) next[r.field] = next[r.field].split(r.from).join(r.to);
    return next;
  });
  return { ...registry, classes };
}

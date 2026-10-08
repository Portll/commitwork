// lib/publish-redactions.mjs — replace customer identifiers in pages generated for the public docsite.
//
// Why this exists at the BOUNDARY rather than in the source: monitor/failure-taxonomy.json and the
// stores around it name real repositories, and they should. An audit record that cannot say which
// repository produced the 605-minute run it calls healthy is not evidence of anything. The register
// is private; the docsite is not; so the sanitising step belongs where the private thing becomes a
// public one — on write, in the generators.
//
// Measured 2026-08-30, which is why this is a module and not a sed: a hand-redaction applied to the
// GENERATED page was reverted by the next regeneration, and the page it would have re-exposed
// (docsite/imported/taxonomy-reference.html) had no test watching it. The redaction map is one
// witness; bin/test/publish-redactions.test.mjs is a second, and it derives its roster from
// monitor/projects.json rather than from this map, so the two cannot fail the same way. A map that
// silently loses an entry is exactly what the second witness exists to catch.
//
// CW_PUBLISH_REDACTIONS overrides the map path, read at CALL time so tests can point it at a
// fixture. Absence is NOT "no mappings": a missing map means the publisher cannot tell whether it is
// about to disclose a client, so every failure here — absent, unreadable, malformed, schema-invalid
// — throws rather than publishing unredacted text.

import { readFileSync } from 'node:fs';
import { validateAgainstSchema } from './json-schema.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Moved to the private stores 2026-09-09. This map pairs every real name with its pseudonym, so it
// IS the reversal table: anyone holding it can undo every substitution in every published artifact.
// The publication boundary names "identity/redaction maps" as permanently private and bars shipping
// "a map that reverses their anonymisation" — and this file was tracked in the public repository,
// which is that rule broken by one of the two files most responsible for keeping it.
export function redactionMapPath(env = process.env) {
  return env.CW_PUBLISH_REDACTIONS || resolve(REPO, 'monitor', 'private', 'publish-redactions.json');
}

export function schemaPath(env = process.env) {
  return env.CW_PUBLISH_REDACTIONS_SCHEMA || resolve(REPO, 'schema', 'publish-redactions.schema.json');
}

export function loadRedactions(env = process.env) {
  const path = redactionMapPath(env);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    // FAIL CLOSED. This returned [] on ENOENT, which reads as "no names to redact" — the exact
    // opposite of the truth. A missing map means the publisher cannot tell whether it is about to
    // disclose a client, and every other failure in this function already refuses to publish
    // unredacted; absence was the one hole in that discipline. It became reachable the moment the
    // map moved out of the public tree (2026-09-09): anything still resolving the old public path
    // finds nothing and would have published in the clear, silently.
    if (e.code === 'ENOENT') {
      throw new Error(`publish-redactions: map is ABSENT at ${path} — refusing to publish, because a missing map is not "nothing to redact"`);
    }
    throw new Error(`publish-redactions: cannot read ${path}: ${e.message}`);
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) {
    throw new Error(`publish-redactions: ${path} is not valid JSON (${e.message}) — refusing to publish unredacted`);
  }
  // The schema is the check, not a second copy of it. A hand-rolled validator beside a schema is
  // the "mirrored" binding this repo already names as a defect: two statements of one truth, of
  // which only the code bites, so they drift without anyone being told.
  const { errors } = validateAgainstSchema(doc, { path: schemaPath(env) });
  if (errors.length) {
    throw new Error(`publish-redactions: ${path} does not satisfy its schema — refusing to publish unredacted:\n  ${errors.join('\n  ')}`);
  }
  const map = doc.map;
  // Longest source first: "clientA-libs" must be consumed before "clientA", or the longer name
  // is left half-redacted as "client-a-libs" spelled over a partial match.
  return Object.entries(map).sort((a, b) => b[0].length - a[0].length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Case-insensitive, because the same repository is written clientA / ClientA / CLIENTA across the
// register and a case-sensitive pass would leave two of those three on the published page.
export function redactForPublish(text, env = process.env) {
  if (typeof text !== 'string') throw new TypeError('publish-redactions: expected a string');
  let out = text;
  for (const [from, to] of loadRedactions(env)) {
    out = out.replace(new RegExp(escapeRe(from), 'gi'), to);
  }
  return out;
}

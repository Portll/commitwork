// bin/lib/format-freeze.mjs — the checks behind manifests/formats.json (docs/STABILITY.md, "Format
// versions"). A frozen format's schema is pinned by fingerprint; changing its shape fails
// bin/test/format-freeze.test.mjs until a history line records the change, and a breaking change
// must also move the version the writer stamps.
import { createHash } from 'node:crypto';

// Annotations do not change what a document may contain: a deprecation notice goes in `description`
// (STABILITY.md) and must not need a version bump.
const ANNOTATIONS = new Set(['description', '$comment', 'title', 'examples']);
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_ONE = new Set(['items', 'additionalItems', 'additionalProperties', 'not', 'if', 'then', 'else',
  'contains', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems']);

const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
};

/** The schema with annotations removed at schema positions only — a PROPERTY named `description`
 *  is shape and stays. */
export function schemaShape(node) {
  if (Array.isArray(node)) return node.map(schemaShape);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (ANNOTATIONS.has(k)) continue;
    if (SCHEMA_MAPS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, schemaShape(sub)]));
    } else if (SCHEMA_LISTS.has(k) && Array.isArray(v)) out[k] = v.map(schemaShape);
    else if (SCHEMA_ONE.has(k)) out[k] = schemaShape(v);
    else out[k] = v;
  }
  return out;
}

export const fingerprint = (value) => `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
export const schemaFingerprint = (schema) => fingerprint(schemaShape(schema));

const major = (semver) => Number(String(semver || '').split('.')[0]);

/**
 * History rules for one frozen format. `actual` is the schema's current fingerprint.
 * Returns violation strings; empty means the history accounts for the schema as it is.
 */
export function historyViolations(entry, actual) {
  const out = [];
  const h = Array.isArray(entry.history) ? entry.history : [];
  if (!h.length) return [`${entry.id}: a frozen format needs a history line pinning its schema`];
  if (h[0].change !== 'initial') out.push(`${entry.id}: the first history line must be change "initial"`);
  for (let i = 1; i < h.length; i++) {
    const prev = h[i - 1];
    const cur = h[i];
    if (cur.change === 'additive' && cur.version !== prev.version) {
      out.push(`${entry.id}: history[${i}] is additive but moves the version ${JSON.stringify(prev.version)} -> ${JSON.stringify(cur.version)}`);
    } else if (cur.change === 'breaking') {
      if (cur.version === prev.version) out.push(`${entry.id}: history[${i}] is breaking and keeps version ${JSON.stringify(cur.version)}; a reader cannot tell the shapes apart`);
      if (major(cur.release) >= 1 && !(major(cur.release) > major(prev.release))) {
        out.push(`${entry.id}: history[${i}] is a breaking change in release ${cur.release}; from 1.0 that needs a major release after ${prev.release}`);
      }
    } else if (cur.change !== 'additive') out.push(`${entry.id}: history[${i}] change must be additive or breaking, not ${JSON.stringify(cur.change)}`);
    if (cur.fingerprint === prev.fingerprint) out.push(`${entry.id}: history[${i}] records no change to the fingerprint`);
  }
  const last = h[h.length - 1];
  if (last.version !== entry.version) {
    out.push(`${entry.id}: version ${JSON.stringify(entry.version)} is not the last history version ${JSON.stringify(last.version)}`);
  }
  if (last.fingerprint !== actual) {
    out.push(`${entry.id}: ${entry.schema} changed shape (pinned ${last.fingerprint}, now ${actual}). Append a history line: `
      + '"additive" keeps the version; "breaking" bumps the version its writer stamps. See docs/STABILITY.md.');
  }
  return out;
}

/** Does `schema` accept exactly `version` in `field`, and require the field? */
export function schemaPinsVersion(schema, field, version) {
  const p = schema && schema.properties && schema.properties[field];
  if (!p) return `the schema declares no '${field}' property`;
  if (!(schema.required || []).includes(field)) return `the schema does not require '${field}'`;
  const pinned = 'const' in p ? p.const : Array.isArray(p.enum) && p.enum.length === 1 ? p.enum[0] : undefined;
  if (pinned === undefined) return `'${field}' is not pinned by const or a one-member enum`;
  return pinned === version ? null : `'${field}' is pinned to ${JSON.stringify(pinned)}, not ${JSON.stringify(version)}`;
}

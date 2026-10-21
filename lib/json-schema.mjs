import { readFileSync } from 'node:fs';

// ── JSON Schema draft-07 subset, fail-closed ─────────────────────────────────────────────────
// Small draft-07 subset checker. A schema keyword this checker does not implement is an ERROR,
// never a skip — quietly ignoring the unevaluable is how a schema goes decorative.
const SCHEMA_ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', 'default', 'examples']);
const SCHEMA_KEYWORDS = new Set(['type', 'required', 'properties', 'additionalProperties', 'items',
  'pattern', 'enum', 'minItems', 'uniqueItems', 'minimum', 'maximum', 'exclusiveMinimum', 'oneOf',
  // fact: `const` is implemented for the same reason as minLength above / a published document's
  // specVersion is the one field a consumer branches on, and `enum` with a single member says the
  // same thing less clearly. Without it an author drops the pin, and an unpinned version field is
  // how a breaking change gets discovered rather than announced.
  'const',
  // fact: minLength/maxLength are implemented because their absence made authors DROP the constraint / an unsupported keyword fails the whole schema, so the cheap fix is to delete it and a required string quietly accepts "" (expiry: never, prev: missing)
  'minLength', 'maxLength',
  // fact: maxItems is implemented for the same reason / a document a model writes has to be bounded, and without the keyword the cap moves out of the schema into code that only some readers run (expiry: never, prev: missing)
  'maxItems',
  // fact: propertyNames is implemented for the same reason as minLength / without it a map keyed by an id accepts any key at all, and dropping the keyword is the cheapest way to make an unsupported schema pass (expiry: never, prev: missing)
  'propertyNames']);

const jsonType = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
const typeOk = (v, t) => (t === 'integer' ? typeof v === 'number' && Number.isInteger(v)
  : t === 'number' ? typeof v === 'number' : jsonType(v) === t);

// JSON Schema compares array members structurally, so object key order cannot make two otherwise
// equal JSON values distinct. Registry inputs are JSON-compatible by the time they reach here.
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

// The schema's own audit — run before the instance is looked at, over the WHOLE tree, so an
// unimplemented keyword cannot hide in a subschema the registry never reaches.
export function checkSchemaSupport(schema, at, errors) {
  const where = at || '(root)';
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    errors.push(`${where}: subschema is not an object — the checker refuses to guess what it means`);
    return;
  }
  for (const k of Object.keys(schema)) {
    if (!SCHEMA_KEYWORDS.has(k) && !SCHEMA_ANNOTATIONS.has(k)) {
      errors.push(`${where}: schema keyword '${k}' is not implemented here, so no registry can be reported valid against it — implement it in lib/json-schema.mjs or drop it from the schema`);
    }
  }
  for (const [k, sub] of Object.entries(schema.properties || {})) checkSchemaSupport(sub, at ? `${at}.${k}` : k, errors);
  if (schema.items !== undefined) checkSchemaSupport(schema.items, `${at}[]`, errors);
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') checkSchemaSupport(schema.additionalProperties, `${at}.*`, errors);
  if (Array.isArray(schema.oneOf)) schema.oneOf.forEach((sub, i) => checkSchemaSupport(sub, `${at}|oneOf[${i}]`, errors));
}

export function checkNode(value, schema, at, errors) {
  const where = at || '(root)';
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return; // already reported by checkSchemaSupport
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(value, t))) {
      errors.push(`${where}: expected ${types.join('|')}, got ${jsonType(value)}`);
      return; // one message per field: cascading into a wrong-typed value's members says nothing new
    }
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => e === value)) {
    errors.push(`${where}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${where}: expected the constant ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  // ReDoS provenance: `pattern` only ever comes from bundled repo-local schemas (or this repo's
  // tests), never from scanned-target data. Revisit if a schema source becomes caller-supplied.
  if (typeof value === 'string' && schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) { // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- pattern is from a bundled repo-local schema only; see comment above
    errors.push(`${where}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (schema.propertyNames !== undefined && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of Object.keys(value)) {
      if (schema.propertyNames.pattern !== undefined && !new RegExp(schema.propertyNames.pattern).test(k)) { // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- pattern is from a bundled repo-local schema only
        errors.push(`${where}: key ${JSON.stringify(k)} does not match propertyNames ${schema.propertyNames.pattern}`);
      }
    }
  }
  if (typeof value === 'string' && schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push(`${where}: string of length ${value.length} is shorter than minLength ${schema.minLength}`);
  }
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push(`${where}: string of length ${value.length} is longer than maxLength ${schema.maxLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && !(value >= schema.minimum)) errors.push(`${where}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && !(value <= schema.maximum)) errors.push(`${where}: ${value} > maximum ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && !(value > schema.exclusiveMinimum)) errors.push(`${where}: ${value} must be > ${schema.exclusiveMinimum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${where}: needs at least ${schema.minItems} item(s), has ${value.length}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${where}: has ${value.length} item(s), more than maxItems ${schema.maxItems}`);
    if (schema.uniqueItems === true) {
      const seen = new Map();
      value.forEach((item, i) => {
        const key = canonicalJson(item);
        if (seen.has(key)) errors.push(`${where}[${i}]: duplicates item ${seen.get(key)} (uniqueItems: true)`);
        else seen.set(key, i);
      });
    }
    if (schema.items !== undefined) value.forEach((v, i) => checkNode(v, schema.items, `${at}[${i}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, r)) errors.push(`${where}: required key '${r}' is missing`);
    }
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      const child = at ? `${at}.${k}` : k;
      if (Object.prototype.hasOwnProperty.call(props, k)) { checkNode(v, props[k], child, errors); continue; }
      if (schema.additionalProperties === false) errors.push(`${where}: unknown key '${k}' (additionalProperties: false)`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') checkNode(v, schema.additionalProperties, child, errors);
    }
  }
  if (schema.oneOf !== undefined) {
    const matched = schema.oneOf.filter((s) => { const sub = []; checkNode(value, s, at, sub); return sub.length === 0; });
    if (matched.length !== 1) errors.push(`${where}: matched ${matched.length} of ${schema.oneOf.length} oneOf branches (exactly 1 required)`);
  }
}

// -> { errors: [] }, each prefixed `schema:`. An unreadable/unparseable schema file is fatal —
// never report a registry valid against a schema nothing opened.
export function validateAgainstSchema(reg, { path } = {}) {
  if (!path) return { errors: ['schema: no schema path given — refusing to report a document valid against nothing'] };
  let schema;
  try { schema = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    return { errors: [`schema: ${path} could not be read or parsed (${e.message}) — refusing to report the registry valid against a schema nothing opened`] };
  }
  const errors = [];
  // Evaluability first: a partial pass is the false green.
  checkSchemaSupport(schema, '', errors);
  if (!errors.length) checkNode(reg, schema, '', errors);
  return { errors: errors.map((m) => `schema: ${m}`) };
}

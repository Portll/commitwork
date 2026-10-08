// cra/csaf-validate.mjs — a structured-field enforcer for the CSAF documents this repo emits.
//
// WHY THIS EXISTS. Every field added to a CSAF document is a promise about a shape: cwes[].id must
// match ^CWE-[1-9]\d{0,5}$, cwes[].name must not begin or end with a space, hyphen, underscore or
// period, metrics[].content.epss.probability must match a fixed decimal pattern, a
// qualitative_severity_rating must be one of five strings. Until now those promises were kept by
// hand and checked by whoever remembered. The KEV mapping added four more fields in one sitting,
// which is exactly the point at which "kept by hand" stops being true.
//
// IT IS NOT A JSON SCHEMA IMPLEMENTATION, AND IT SAYS SO. Zero dependencies is a house rule, and a
// half-built validator that reports `valid` for constructs it cannot read would be the exact defect
// this repository exists to catch — a green that means "not checked". So every construct it does
// not understand is counted as UNCHECKED and returned beside the errors. A caller that treats an
// empty error list as conformance without reading `unchecked` has made the mistake for itself, and
// the field name is the warning.
//
// Understood: type, required, enum, pattern, minLength, minItems, uniqueItems, properties, items,
// additionalProperties:false, and local $ref into #/$defs.
// NOT understood, and counted: remote $ref (the CVSS and SSVC schemas live at first.org and
// certcc.github.io), oneOf/anyOf/allOf, if/then, dependent schemas, format.
//
// Zero deps, pure, no I/O — the schema and the document are both handed in.

/** Resolve a local `#/$defs/...` reference. Remote refs are not resolved; the caller counts them. */
function deref(schema, root) {
  let s = schema; let guard = 0;
  while (s && typeof s.$ref === 'string' && s.$ref.startsWith('#/') && guard++ < 20) {
    const path = s.$ref.slice(2).split('/');
    let t = root;
    // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop -- read-only traversal, nothing is assigned
    for (const seg of path) t = t?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (!t) return { schema: null, remote: false, missing: s.$ref };
    const { $ref, ...rest } = s;
    s = Object.keys(rest).length ? { ...t, ...rest } : t;
  }
  if (s && typeof s.$ref === 'string') return { schema: null, remote: true, ref: s.$ref };
  return { schema: s, remote: false };
}

const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/**
 * Validate `doc` against `schema`.
 * @returns {{errors: string[], unchecked: string[], checked: number}}
 *   `errors`   — a promise the document breaks. Never empty out of politeness.
 *   `unchecked` — a construct this validator cannot read, at a path. NOT a pass.
 *   `checked`  — how many values were actually examined, so a vacuous run is visible.
 */
export function validateCsaf(doc, schema) {
  const errors = []; const unchecked = []; let checked = 0;

  const walk = (value, sch, path) => {
    const r = deref(sch, schema);
    if (r.remote) { unchecked.push(`${path}: remote $ref ${r.ref}`); return; }
    if (r.missing) { unchecked.push(`${path}: unresolvable $ref ${r.missing}`); return; }
    const s = r.schema;
    if (!s || typeof s !== 'object') return;

    for (const k of ['oneOf', 'anyOf', 'allOf', 'if', 'not', 'dependentSchemas']) {
      if (s[k]) { unchecked.push(`${path}: ${k} is not evaluated`); }
    }
    if (value === undefined) return;
    checked += 1;

    if (s.type) {
      const want = Array.isArray(s.type) ? s.type : [s.type];
      const got = typeOf(value);
      const ok = want.includes(got) || (want.includes('integer') && Number.isInteger(value));
      if (!ok) { errors.push(`${path}: expected ${want.join('|')}, got ${got}`); return; }
    }
    if (s.enum && !s.enum.includes(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(s.enum)}`);
    }
    if (typeof value === 'string') {
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- pattern is a "pattern" keyword of the bundled CSAF schema, never of the document being validated; the document supplies only the tested value
      if (s.pattern && !new RegExp(s.pattern).test(value)) {
        errors.push(`${path}: ${JSON.stringify(value)} does not match ${s.pattern}`);
      }
      if (s.minLength !== undefined && value.length < s.minLength) {
        errors.push(`${path}: shorter than minLength ${s.minLength}`);
      }
      if (s.format) unchecked.push(`${path}: format "${s.format}" is not evaluated`);
    }
    if (Array.isArray(value)) {
      if (s.minItems !== undefined && value.length < s.minItems) {
        errors.push(`${path}: ${value.length} items, minItems is ${s.minItems}`);
      }
      if (s.uniqueItems) {
        const seen = new Set(value.map((x) => JSON.stringify(x)));
        if (seen.size !== value.length) errors.push(`${path}: items are not unique`);
      }
      if (s.items) value.forEach((x, i) => walk(x, s.items, `${path}[${i}]`));
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const req of (s.required || [])) {
        if (value[req] === undefined) errors.push(`${path}: missing required property "${req}"`);
      }
      if (s.minProperties !== undefined && Object.keys(value).length < s.minProperties) {
        errors.push(`${path}: ${Object.keys(value).length} properties, minProperties is ${s.minProperties}`);
      }
      for (const [k, v] of Object.entries(value)) {
        if (s.properties?.[k]) walk(v, s.properties[k], `${path}.${k}`);
        else if (s.additionalProperties === false) errors.push(`${path}.${k}: not permitted (additionalProperties is false)`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(v, s.additionalProperties, `${path}.${k}`);
      }
    }
  };

  walk(doc, schema, '$');
  return { errors, unchecked, checked };
}

/**
 * The ENFORCER. Throws rather than returning a flag, because the caller is a writer: a document
 * that breaks its own schema must not reach disk, where it becomes evidence someone cites.
 * `unchecked` is reported in the message on failure but never causes one — an unevaluated construct
 * is an admission of this validator's limits, not a defect in the document.
 */
export function assertCsafValid(doc, schema, label = 'document') {
  const { errors, unchecked, checked } = validateCsaf(doc, schema);
  if (checked === 0) {
    throw new Error(`${label}: the validator examined NOTHING — a vacuous pass is not a pass`);
  }
  if (errors.length) {
    throw new Error(
      `${label}: ${errors.length} schema violation(s), refusing to write.\n  `
      + errors.slice(0, 12).join('\n  ')
      + (errors.length > 12 ? `\n  …and ${errors.length - 12} more` : '')
      + `\n  (${checked} values checked; ${unchecked.length} construct(s) this validator cannot read)`,
    );
  }
  return { checked, unchecked };
}

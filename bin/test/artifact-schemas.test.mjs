// The shell-written artifacts, held to their declared shapes.
//
// bin/boot-harness.sh and bin/lockfile-synth.sh hand-build JSON strings, so nothing in them could
// be schema-checked at authoring time — and both shipped multi-state documents with no schema at
// all, beside scannerFindings rows that were machine-validated the whole time.
//
// THE TEMPLATES ARE DERIVED FROM THE SCRIPTS, NOT TRANSCRIBED. A hand-copied list of the shapes
// would be a second copy of the thing it describes, drifting silently and flatteringly — the exact
// class this repo has been bitten by four times in a week. So the test reads each `emit "{...}"`
// out of the script source, fills its shell placeholders using the TYPE THE SCHEMA DECLARES for
// that key, and validates the result. Add a fifth emit to either script and it is covered on the
// next run; add one with an undeclared key and this fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateAgainstSchema } from '../../monitor/registry.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const schemaFor = (name) => join(ROOT, 'schema', `${name}.schema.json`);

/** Every `emit "{...}"` in a script, as a raw (still shell-escaped) JSON template. */
function emitTemplates(scriptPath) {
  const src = readFileSync(scriptPath, 'utf8');
  const out = [];
  for (const line of src.split('\n')) {
    const m = /emit "(\{.*\})"/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Fill shell placeholders with values of the type the SCHEMA declares for each key.
 *
 * Deriving the substitution from the schema rather than a lookup table is what keeps this from
 * being another hand-maintained parallel list: a key the schema does not declare gets no value,
 * stays a raw `$VAR`, fails to parse, and is reported — which is the outcome we want for it.
 */
function fill(template, schema) {
  let s = template.replace(/\\"/g, '"');
  // Command substitutions first — `$([ -n "$COMPOSE" ] && echo compose || echo dockerfile)` carries
  // its own quotes, and any value-level pass run before this one tears it in half.
  s = s.replace(/\$\([^)]*\)/g, '__SHELL__');
  // Quoted placeholders, key-aware: an enum key must get a value its enum allows, or this test
  // fails on its own substitution rather than on the script.
  s = s.replace(/"([A-Za-z][A-Za-z0-9]*)":"([^"]*)"/g, (whole, key, val) => {
    if (!/__SHELL__|\$/.test(val)) return whole;                  // a literal — leave it alone
    const p = schema.properties?.[key] || {};
    if (Array.isArray(p.enum)) return `"${key}":"${p.enum[0]}"`;
    if (p.pattern) return whole;                                  // cannot synthesise; fail loudly
    return `"${key}":"x"`;
  });
  // unquoted placeholders take their type from the schema
  s = s.replace(/"([A-Za-z][A-Za-z0-9]*)":(\$\{?[A-Za-z_][A-Za-z0-9_]*(:-[^}]*)?\}?)/g, (whole, key) => {
    const t = schema.properties?.[key]?.type;
    if (t === 'integer' || t === 'number') return `"${key}":1`;
    if (t === 'boolean') return `"${key}":true`;
    if (t === 'string') return `"${key}":"x"`;
    return whole;                       // undeclared: leave it broken so it surfaces
  });
  return s;
}

for (const [name, script] of [['boot-harness', 'boot-harness.sh'], ['lockfile-synth', 'lockfile-synth.sh']]) {
  test(`every shape ${script} can emit validates against schema/${name}.schema.json`, () => {
    const schema = JSON.parse(readFileSync(schemaFor(name), 'utf8'));
    const templates = emitTemplates(join(ROOT, 'bin', script));
    // Non-vacuity. An empty template list would pass this test having checked nothing, which is
    // precisely the failure the schemas were added to close.
    assert.ok(templates.length >= 3,
      `expected at least 3 emit templates in ${script}, found ${templates.length} — if the emit form changed, this test is now blind`);

    for (const t of templates) {
      const filled = fill(t, schema);
      let doc;
      assert.doesNotThrow(() => { doc = JSON.parse(filled); },
        `an emit template did not survive placeholder filling — a key the schema does not declare is the usual cause:\n${filled}`);
      const { errors } = validateAgainstSchema(doc, { path: schemaFor(name) });
      assert.deepEqual(errors, [], `this emitted shape does not match its schema:\n${filled}`);
    }
  });
}

test('a misspelled key is refused — additionalProperties:false is what makes an absent key mean something', () => {
  // The negative control. Without it, every assertion above is consistent with a schema that
  // accepts anything.
  const good = { tool: 'boot-harness', generatedAt: 'x', ran: true, booted: true, bootable: true };
  assert.deepEqual(validateAgainstSchema(good, { path: schemaFor('boot-harness') }).errors, [],
    'the control must pass before its mutations mean anything');
  const typo = validateAgainstSchema({ ...good, bootted: true }, { path: schemaFor('boot-harness') });
  assert.match(typo.errors.join('\n'), /unknown key 'bootted'/);
  const badMode = validateAgainstSchema({ ...good, mode: 'kubernetes' }, { path: schemaFor('boot-harness') });
  assert.match(badMode.errors.join('\n'), /mode/, 'a mode this harness cannot produce means writer and reader disagree');
});

test('the synthetic lockfile keeps the CANONICAL filename — osv-scanner selects its extractor by NAME', () => {
  // Verified 2026-08-22: a valid npm lockfile named package-lock.synth.json returns "could not
  // determine extractor suitable to this file" and scans NOTHING, while the identical bytes under
  // package-lock.json find GHSA-qwww-vcr4-c8h2. The synthetic-ness must live in the DIRECTORY.
  const base = { tool: 'lockfile-synth', generatedAt: 'x', ran: true, synthesised: true, ecosystem: 'npm', packages: 1 };
  const ok = validateAgainstSchema({ ...base, lockfile: 'lockfile-synth/package-lock.json' }, { path: schemaFor('lockfile-synth') });
  assert.deepEqual(ok.errors, []);
  const renamed = validateAgainstSchema({ ...base, lockfile: 'lockfile-synth/package-lock.synth.json' }, { path: schemaFor('lockfile-synth') });
  assert.match(renamed.errors.join('\n'), /lockfile/,
    'a descriptive filename silently disables the scanner that reads it — the schema is where that gets caught now');
});

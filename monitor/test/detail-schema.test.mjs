// monitor/detail-schema.mjs — the single declaration of a drill-down row.
//
// The properties worth testing here are the ones a reviewer cannot eyeball across 21 categories:
// that a row is CONSTRUCTED from the schema rather than filtered (so a credential field in a
// scanner artifact cannot reach a browser by being added upstream), that the checked-in JSON
// Schema has not drifted from the table it is generated from, and that every category the rollup
// publishes actually has a schema — because a category without one is exactly how 4,832 findings
// ended up with no drill-down anywhere in the site.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROW_SCHEMAS, rowsFor, validateRows, detailKeys, panelSchema, comparatorFor, jsonSchema, _limits } from '../detail-schema.mjs';
import { SCANNER_SPECS, MESSAGE_CAP } from '../extractors.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('a row is built from the schema, not filtered into it', () => {
  test('an undeclared field cannot reach a row — even one carrying a live secret', () => {
    // trufflehog.json really does carry Raw/RawV2/Redacted, and gitleaks.json really does carry
    // Secret/Match whether or not --redact was passed. Filtering can be outrun by a format change;
    // construction cannot, because the extra field is never read.
    const rows = rowsFor('secretsHistory', [{
      detector: 'Postgres', file: 'a.ts', line: 3, commit: 'abc', verified: true,
      Raw: 'postgres://user:REALPASSWORD@host/db', RawV2: 'x', Redacted: 'y', ExtraData: { k: 'v' },
    }]);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['commit', 'detector', 'file', 'line', 'sev', 'verificationError', 'verified']);
    assert.equal(JSON.stringify(rows).includes('REALPASSWORD'), false, 'a declared-fields-only row must not carry the secret');
  });

  test('a declared field that the source lacks becomes the type empty, never undefined', () => {
    // an absent key would vanish from JSON.stringify and give two re-rolls of one batch different
    // bytes — the rerollup-identical gate is the reason this matters, not tidiness.
    const [r] = rowsFor('sastSemgrep', [{ rule: 'r' }]);
    assert.deepEqual(r, { rule: 'r', file: '', line: 0, sev: '', message: '', cwe: '', corroboratedBy: '' });
    assert.equal(JSON.stringify(r).includes('undefined'), false);
  });

  test('types are BOUNDS: sev is closed, text keeps the capMessage marker, str truncates', () => {
    const [r] = rowsFor('sastSemgrep', [{ rule: 'x'.repeat(400), sev: 'catastrophic', message: 'y'.repeat(9000) }]);
    assert.equal(r.rule.length, _limits.STR_MAX);
    assert.equal(r.sev, '', 'a severity outside the four buckets must not pass through — it would disagree with the tally above it');
    assert.match(r.message, /truncated at 4000 chars/, 'a cut message must SAY it was cut');
    assert.equal(_limits.TEXT_MAX, MESSAGE_CAP, 'the schema text bound and extractors.mjs MESSAGE_CAP must be the same number');
  });

  test('rows come back in the schema\'s declared order, so a re-roll is byte-identical', () => {
    const items = [{ file: 'b.js', line: 1, rule: 'r' }, { file: 'a.js', line: 9, rule: 'r' }, { file: 'a.js', line: 2, rule: 'r' }];
    const a = rowsFor('sastSemgrep', items).map((r) => `${r.file}:${r.line}`);
    const b = rowsFor('sastSemgrep', [...items].reverse()).map((r) => `${r.file}:${r.line}`);
    assert.deepEqual(a, ['a.js:2', 'a.js:9', 'b.js:1']);
    assert.deepEqual(a, b, 'input order must not survive into the artifact');
  });

  test('an unschema\'d category returns null — counts only, never an unvalidated publish', () => {
    assert.equal(rowsFor('somethingNobodyDeclared', [{ a: 1 }]), null);
    assert.equal(comparatorFor('somethingNobodyDeclared')({}, {}), 0);
  });
});

describe('validateRows reports drift rather than repairing it', () => {
  test('an undeclared field on a published row is a violation, not a silent drop', () => {
    const v = validateRows('secrets', [{ rule: 'r', file: 'f', line: 1, commit: 'c', redacted: true, Secret: 'LIVE' }]);
    assert.ok(v.some((m) => m.includes("undeclared field 'Secret'")), v.join(' | '));
  });
  test('a missing declared field is a violation', () => {
    assert.ok(validateRows('secrets', [{ rule: 'r' }]).some((m) => m.includes('missing declared field')));
  });
  test('`repo` is allowed — the rollup prepends it on the fleet flatten', () => {
    // The row is DERIVED from the schema rather than spelled out. Spelling it out made this test
    // fail the moment `secrets` gained verified/entropy/testPath — it was asserting a field list,
    // not the thing it is named for. rowsFor() supplies whatever the declaration currently says,
    // so the only claim left is the one under test: an added `repo` is not a violation.
    const [row] = rowsFor('secrets', [{ rule: 'r', file: 'f', line: 1, sev: 'high', commit: 'c', redacted: true }]);
    assert.ok(Object.keys(row).length >= 6, 'a vacuous row would make this pass having checked nothing');
    assert.deepEqual(validateRows('secrets', [{ repo: 'x', ...row }]), []);
  });
  test('a conforming set returns [] — the affirmative "checked", not an absent answer', () => {
    assert.deepEqual(validateRows('stubs', rowsFor('stubs', [{ marker: 'TODO', file: 'a.js', line: 2, sev: 'high', message: 'x' }])), []);
  });
});

describe('the declaration is the only copy', () => {
  test('every SCANNER_SPECS category that can carry detail has a schema', () => {
    // the gap this whole module closes: an extractor emitting rows for a key nothing declared meant
    // the rollup dropped them, silently. 21 categories, 21 schemas.
    const specKeys = SCANNER_SPECS.map(([k]) => k);
    const missing = specKeys.filter((k) => !ROW_SCHEMAS[k]);
    assert.deepEqual(missing, [], `these scanner categories can never publish a drill-down: ${missing.join(', ')}`);
  });

  test('detailKeys() and the panel schema agree with ROW_SCHEMAS — no third list', () => {
    assert.deepEqual(detailKeys().sort(), Object.keys(ROW_SCHEMAS).sort());
    assert.deepEqual(Object.keys(panelSchema()).sort(), Object.keys(ROW_SCHEMAS).sort());
    for (const [key, s] of Object.entries(panelSchema())) {
      assert.equal(s.columns.length, ROW_SCHEMAS[key].fields.length, `${key}: column count must match the field list`);
      assert.ok(s.note && s.note.length > 20, `${key}: every category must say what ONE ROW of it means`);
    }
  });

  test('every sort key names a field that exists on that category', () => {
    for (const [key, s] of Object.entries(ROW_SCHEMAS)) {
      const names = new Set(s.fields.map(([n]) => n));
      for (const f of s.sort) assert.ok(names.has(f), `${key}: sorts on '${f}', which it does not declare`);
    }
  });

  test('the checked-in JSON Schema has not drifted from the table it is generated from', () => {
    const onDisk = JSON.parse(readFileSync(join(CW, 'schema', 'scanner-finding.schema.json'), 'utf8'));
    assert.deepEqual(onDisk, jsonSchema(),
      'schema/scanner-finding.schema.json is stale — regenerate with `node monitor/detail-schema.mjs --write`');
  });

  test('the published schema refuses extra properties — the clause is load-bearing', () => {
    const js = jsonSchema();
    for (const [key, spec] of Object.entries(js.properties)) {
      assert.equal(spec.items.additionalProperties, false,
        `${key}: without additionalProperties:false the schema would permit exactly the credential fields it exists to exclude`);
    }
  });
});

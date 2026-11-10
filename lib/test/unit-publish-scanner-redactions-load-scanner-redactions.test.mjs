// Reads the redactions file, returning [] if absent, else the schema-validated redactions array (lib/publish-scanner-redactions.mjs loadScannerRedactions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScannerRedactions } from '../publish-scanner-redactions.mjs';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCHEMA = { type: 'object', properties: { redactions: { type: 'array' } }, required: ['redactions'] };

test('returns empty array when the redactions file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerRedactions-'));
  try {
    const missing = join(dir, 'missing.json');
    const schema = join(dir, 'schema.json');
    writeFileSync(schema, JSON.stringify(SCHEMA));
    const r = loadScannerRedactions({ CW_PUBLISH_SCANNER_REDACTIONS: missing, CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: schema });
    assert.deepEqual(r, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws a cannot read error when the redactions path is a directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerRedactions-'));
  try {
    const sub = join(dir, 'red.json');
    mkdirSync(sub);
    const schema = join(dir, 'schema.json');
    writeFileSync(schema, JSON.stringify(SCHEMA));
    assert.throws(
      () => loadScannerRedactions({ CW_PUBLISH_SCANNER_REDACTIONS: sub, CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: schema }),
      { name: 'Error', message: `publish-scanner-redactions: cannot read ${sub}: EISDIR: illegal operation on a directory, read` },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns the redactions array from a valid document', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerRedactions-'));
  try {
    const red = join(dir, 'red.json');
    const schema = join(dir, 'schema.json');
    writeFileSync(red, JSON.stringify({ redactions: [{ pattern: 'secret' }] }));
    writeFileSync(schema, JSON.stringify(SCHEMA));
    const r = loadScannerRedactions({ CW_PUBLISH_SCANNER_REDACTIONS: red, CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: schema });
    assert.deepEqual(r, [{ pattern: 'secret' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the redactions file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerRedactions-'));
  try {
    const red = join(dir, 'red.json');
    const schema = join(dir, 'schema.json');
    writeFileSync(red, 'not json');
    writeFileSync(schema, JSON.stringify({ type: 'object' }));
    assert.throws(
      () => loadScannerRedactions({ CW_PUBLISH_SCANNER_REDACTIONS: red, CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: schema }),
      { name: 'Error', message: `publish-scanner-redactions: ${red} is not valid JSON (Unexpected token 'o', "not json" is not valid JSON) \u2014 refusing to publish unredacted` },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throws when the document fails schema validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadScannerRedactions-'));
  try {
    const red = join(dir, 'red.json');
    const schema = join(dir, 'schema.json');
    writeFileSync(red, JSON.stringify({ redactions: 'not-an-array' }));
    writeFileSync(schema, JSON.stringify(SCHEMA));
    assert.throws(
      () => loadScannerRedactions({ CW_PUBLISH_SCANNER_REDACTIONS: red, CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: schema }),
      { name: 'Error', message: `publish-scanner-redactions: ${red} does not satisfy its schema \u2014 refusing to publish unredacted:\n  schema: redactions: expected array, got string` },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

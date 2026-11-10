// Registry copy with the configured scanner text redactions applied (lib/publish-scanner-redactions.mjs redactScannersForPublish).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactScannersForPublish } from '../publish-scanner-redactions.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withRedactions(redactions, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'redactScannersForPublish-'));
  try {
    const schemaPath = join(dir, 'schema.json');
    const redactionsPath = join(dir, 'redactions.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object', properties: { redactions: { type: 'array' } }, required: ['redactions'] }));
    if (redactions !== undefined) writeFileSync(redactionsPath, JSON.stringify({ redactions }));
    return fn({ CW_PUBLISH_SCANNER_REDACTIONS: redactionsPath, CW_PUBLISH_SCANNER_REDACTIONS_SCHEMA: schemaPath });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TYPE_MSG = 'publish-scanner-redactions: expected a registry with a classes array';

test('returns the same registry object when the redactions file does not exist', () => {
  withRedactions(undefined, (env) => {
    const registry = { classes: [{ id: 'a', desc: 'my secret key' }] };
    assert.equal(redactScannersForPublish(registry, env), registry);
  });
});

test('returns the registry untouched, even null, when the redactions list is empty', () => {
  withRedactions([], (env) => {
    assert.equal(redactScannersForPublish(null, env), null);
    const registry = { classes: [{ id: 'a', desc: 'my secret key' }] };
    assert.equal(redactScannersForPublish(registry, env), registry);
  });
});

test('throws a TypeError when the registry is null and one redaction exists', () => {
  withRedactions([{ class: 'a', field: 'desc', from: 'x', to: 'y' }], (env) => {
    assert.throws(() => redactScannersForPublish(null, env), { name: 'TypeError', message: TYPE_MSG });
  });
});

test('throws a TypeError when the registry has no classes array', () => {
  withRedactions([{ class: 'a', field: 'desc', from: 'x', to: 'y' }], (env) => {
    assert.throws(() => redactScannersForPublish({ foo: 'bar' }, env), { name: 'TypeError', message: TYPE_MSG });
    assert.throws(() => redactScannersForPublish({ classes: 'nope' }, env), { name: 'TypeError', message: TYPE_MSG });
  });
});

test('replaces every occurrence of the from text in the redacted class only', () => {
  withRedactions([{ class: 'a', field: 'desc', from: 'secret', to: 'redacted' }], (env) => {
    const other = { id: 'b', desc: 'other secret' };
    const registry = { version: 3, classes: [{ id: 'a', desc: 'my secret key, secret' }, other] };
    const r = redactScannersForPublish(registry, env);
    assert.deepEqual(r, { version: 3, classes: [{ id: 'a', desc: 'my redacted key, redacted' }, { id: 'b', desc: 'other secret' }] });
    assert.equal(r.classes[1], other);
    assert.equal(registry.classes[0].desc, 'my secret key, secret');
  });
});

test('replaces a from text that is the entire field value', () => {
  withRedactions([{ class: 'a', field: 'title', from: 'secret', to: 'X' }], (env) => {
    const r = redactScannersForPublish({ classes: [{ id: 'a', title: 'secret', desc: 'keep' }] }, env);
    assert.deepEqual(r, { classes: [{ id: 'a', title: 'X', desc: 'keep' }] });
  });
});

test('ignores a redaction for a class the registry does not hold', () => {
  const redactions = [
    { class: 'missing', field: 'desc', from: 'x', to: 'y' },
    { class: 'a', field: 'desc', from: 'hello', to: 'bye' },
  ];
  withRedactions(redactions, (env) => {
    const r = redactScannersForPublish({ classes: [{ id: 'a', desc: 'hello there' }] }, env);
    assert.deepEqual(r, { classes: [{ id: 'a', desc: 'bye there' }] });
  });
});

test('refuses to publish when the redacted field is not a string', () => {
  const redactions = [
    { class: 'a', field: 'desc', from: 'x', to: 'y' },
    { class: 'a', field: 'title', from: 'x', to: 'y' },
  ];
  withRedactions(redactions, (env) => {
    assert.throws(() => redactScannersForPublish({ classes: [{ id: 'a', desc: 123 }] }, env), {
      name: 'Error',
      message: 'publish-scanner-redactions: refusing to publish \u2014 2 redaction(s) no longer match their record:\n  a.desc: not a string\n  a.title: not a string',
    });
  });
});

test('refuses to publish when the from text no longer occurs in the field', () => {
  withRedactions([{ class: 'a', field: 'desc', from: 'Secret', to: 'y' }], (env) => {
    assert.throws(() => redactScannersForPublish({ classes: [{ id: 'a', desc: 'my secret key' }] }, env), {
      name: 'Error',
      message: 'publish-scanner-redactions: refusing to publish \u2014 1 redaction(s) no longer match their record:\n  a.desc: "Secret" no longer occurs \u2014 the text was reworded and this redaction stopped applying',
    });
  });
});

// Formats a human-readable error message for missing secrets (lib/secrets.mjs reportMissing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportMissing } from '../secrets.mjs';

test('returns an empty string when no secrets are missing', () => {
  const r = reportMissing([], { context: '', logger: { error() {} } });
  assert.equal(r, "");
});

test('reports a single missing secret without a plural suffix', () => {
  const r = reportMissing([{ name: 'API_KEY', reason: 'env', detail: 'not set' }], { context: '', logger: { error() {} } });
  assert.equal(r, "MISSING SECRET: API_KEY\n  - API_KEY: env \u2014 not set\n  This is reported rather than skipped on purpose: a credential that is absent must not\n  degrade into a silent no-op. Declare it with `node bin/secrets.mjs set <NAME>`, or set\n  the environment variable directly for a one-off.");
});

test('reports two missing secrets with a plural suffix', () => {
  const r = reportMissing(
    [
      { name: 'API_KEY', reason: 'env', detail: 'not set' },
      { name: 'DB_PASS', reason: 'env', detail: 'not set' }
    ],
    { context: '', logger: { error() {} } }
  );
  assert.equal(r, "MISSING SECRETS: API_KEY, DB_PASS\n  - API_KEY: env \u2014 not set\n  - DB_PASS: env \u2014 not set\n  This is reported rather than skipped on purpose: a credential that is absent must not\n  degrade into a silent no-op. Declare it with `node bin/secrets.mjs set <NAME>`, or set\n  the environment variable directly for a one-off.");
});

test('reports three missing secrets with a plural suffix', () => {
  const r = reportMissing(
    [
      { name: 'API_KEY', reason: 'env', detail: 'not set' },
      { name: 'DB_PASS', reason: 'env', detail: 'not set' },
      { name: 'JWT_SECRET', reason: 'env', detail: 'not set' }
    ],
    { context: '', logger: { error() {} } }
  );
  assert.equal(r, "MISSING SECRETS: API_KEY, DB_PASS, JWT_SECRET\n  - API_KEY: env \u2014 not set\n  - DB_PASS: env \u2014 not set\n  - JWT_SECRET: env \u2014 not set\n  This is reported rather than skipped on purpose: a credential that is absent must not\n  degrade into a silent no-op. Declare it with `node bin/secrets.mjs set <NAME>`, or set\n  the environment variable directly for a one-off.");
});

test('includes the context in the header when provided', () => {
  const r = reportMissing([{ name: 'API_KEY', reason: 'env', detail: 'not set' }], { context: 'deploy', logger: { error() {} } });
  assert.equal(r, "MISSING SECRET for deploy: API_KEY\n  - API_KEY: env \u2014 not set\n  This is reported rather than skipped on purpose: a credential that is absent must not\n  degrade into a silent no-op. Declare it with `node bin/secrets.mjs set <NAME>`, or set\n  the environment variable directly for a one-off.");
});

test('logs the message via the provided logger', () => {
  let logged = null;
  const r = reportMissing([{ name: 'API_KEY', reason: 'env', detail: 'not set' }], { context: '', logger: { error(m) { logged = m; } } });
  assert.equal(logged, "MISSING SECRET: API_KEY\n  - API_KEY: env \u2014 not set\n  This is reported rather than skipped on purpose: a credential that is absent must not\n  degrade into a silent no-op. Declare it with `node bin/secrets.mjs set <NAME>`, or set\n  the environment variable directly for a one-off.");
});

test('includes the exact remediation instruction with angle brackets', () => {
  const r = reportMissing([{ name: 'API_KEY', reason: 'env', detail: 'not set' }], { context: '', logger: { error() {} } });
  assert.equal(r, "MISSING SECRET: API_KEY\n  - API_KEY: env \u2014 not set\n  This is reported rather than skipped on purpose: a credential that is absent must not\n  degrade into a silent no-op. Declare it with `node bin/secrets.mjs set <NAME>`, or set\n  the environment variable directly for a one-off.");
});

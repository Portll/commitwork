// setExternalSsoAllowed: only a literal true enables remote SSO, the answer is persisted, and nothing else in the store changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalSsoAllowed, setExternalSsoAllowed } from '../auth.mjs';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seed = (allow) => ({
  version: 1,
  users: [{ id: 'u1', email: 'alice@example.com', passkeys: [] }],
  settings: { allowExternalSso: allow, keptSetting: 'unchanged' },
});

function withStore(initial, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'setExternalSsoAllowed-'));
  const storePath = join(dir, 'auth.json');
  const original = process.env.CW_AUTH_STORE;
  process.env.CW_AUTH_STORE = storePath;
  try {
    writeFileSync(storePath, JSON.stringify(initial));
    return fn(() => JSON.parse(readFileSync(storePath, 'utf8')));
  } finally {
    if (original === undefined) delete process.env.CW_AUTH_STORE; else process.env.CW_AUTH_STORE = original;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('true enables remote SSO, and the stored flag and the live check agree', () => {
  withStore(seed(false), (read) => {
    assert.equal(setExternalSsoAllowed(true), true);
    assert.equal(read().settings.allowExternalSso, true);
    assert.equal(externalSsoAllowed(), true);
  });
});

test('false disables remote SSO that was enabled', () => {
  withStore(seed(true), (read) => {
    assert.equal(setExternalSsoAllowed(false), false);
    assert.equal(read().settings.allowExternalSso, false);
    assert.equal(externalSsoAllowed(), false);
  });
});

test('a truthy value that is not literally true disables remote SSO', () => {
  for (const value of ['true', 1, {}, [true], null, undefined]) {
    withStore(seed(true), (read) => {
      assert.equal(setExternalSsoAllowed(value), false, JSON.stringify(value));
      assert.equal(read().settings.allowExternalSso, false, JSON.stringify(value));
    });
  }
});

test('toggling leaves users and every other setting as they were', () => {
  withStore(seed(false), (read) => {
    setExternalSsoAllowed(true);
    assert.deepEqual(read(), seed(true));
  });
});

// One row per roster identity with its metadata, keychain ref and probe outcome (lib/repo-identity.mjs status).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { status, identityRefFor, resolveIdentity } from '../repo-identity.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const U1 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const U2 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function withRoster(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'status-'));
  try {
    const path = join(dir, 'repo-identity.json');
    if (content !== undefined) writeFileSync(path, content);
    return fn({ CW_REPO_IDENTITY_ROSTER: path }, path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function probedRow(uuid, meta, env) {
  const r = resolveIdentity(uuid, { env });
  const row = { uuid, ...meta, ref: identityRefFor(uuid), resolvable: r.ok };
  if (!r.ok) { row.reason = r.reason; row.detail = r.detail; }
  return row;
}

test('A missing roster file yields an empty list even with probing on', () => {
  withRoster(undefined, (env) => {
    assert.deepEqual(status({ env }), []);
  });
});

test('A roster without an identities map yields an empty list', () => {
  withRoster(JSON.stringify({ version: 1 }), (env) => {
    assert.deepEqual(status({ env, probe: true }), []);
  });
});

test('With probing off each identity becomes its uuid, metadata and ref in roster order', () => {
  const roster = { version: 1, identities: { [U1]: { label: 'alpha', owner: 'ops' }, [U2]: {} } };
  withRoster(JSON.stringify(roster), (env) => {
    assert.deepEqual(status({ env, probe: false }), [
      { uuid: U1, label: 'alpha', owner: 'ops', ref: identityRefFor(U1) },
      { uuid: U2, ref: identityRefFor(U2) },
    ]);
  });
});

test('Metadata can override the uuid field but never the ref', () => {
  const roster = { identities: { [U1]: { uuid: 'shadow', ref: 'forged', label: 'b' } } };
  withRoster(JSON.stringify(roster), (env) => {
    assert.deepEqual(status({ env, probe: false }), [
      { uuid: 'shadow', ref: identityRefFor(U1), label: 'b' },
    ]);
  });
});

test('Probing is on by default and records resolvability with reason and detail when unresolved', () => {
  const roster = { identities: { [U1]: { label: 'alpha' } } };
  withRoster(JSON.stringify(roster), (env) => {
    const rows = status({ env });
    assert.deepEqual(rows, [probedRow(U1, { label: 'alpha' }, env)]);
  });
});

test('Explicit probing gives one probed row per identity', () => {
  const roster = { identities: { [U1]: { label: 'one' }, [U2]: { label: 'two' } } };
  withRoster(JSON.stringify(roster), (env) => {
    const rows = status({ env, probe: true });
    assert.deepEqual(rows, [
      probedRow(U1, { label: 'one' }, env),
      probedRow(U2, { label: 'two' }, env),
    ]);
  });
});

test('A roster that is a JSON array is rejected as not an object', () => {
  withRoster('[]', (env, path) => {
    assert.throws(() => status({ env, probe: false }), {
      name: 'Error',
      message: `repo-identity: roster at ${path} is not an object`,
    });
  });
});

test('A null JSON roster is rejected as not an object', () => {
  withRoster('null', (env, path) => {
    assert.throws(() => status({ env }), {
      name: 'Error',
      message: `repo-identity: roster at ${path} is not an object`,
    });
  });
});

test('An identities field that is an array is rejected as a non-object map', () => {
  withRoster(JSON.stringify({ identities: [U1] }), (env, path) => {
    assert.throws(() => status({ env, probe: false }), {
      name: 'Error',
      message: `repo-identity: roster at ${path} has a non-object 'identities' map`,
    });
  });
});

test('A roster key that is not a v4 UUID is rejected by name', () => {
  withRoster(JSON.stringify({ identities: { abc: {} } }), (env, path) => {
    assert.throws(() => status({ env }), {
      name: 'Error',
      message: `repo-identity: roster at ${path} holds "abc", which is not a v4 UUID`,
    });
  });
});

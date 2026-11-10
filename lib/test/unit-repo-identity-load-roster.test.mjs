// Reads the repo-identity roster JSON and checks its shape, or returns an empty roster if the file is missing (lib/repo-identity.mjs loadRoster).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRoster } from '../repo-identity.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withRoster(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadRoster-'));
  try {
    const p = join(dir, 'roster.json');
    if (content !== undefined) writeFileSync(p, content);
    fn(p, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const env = (p) => ({ CW_REPO_IDENTITY_ROSTER: p });
const UUID = '123e4567-e89b-42d3-a456-426614174000';

test('a missing roster file yields the empty roster', () => {
  withRoster(undefined, (p) => {
    assert.deepEqual(loadRoster(env(p)), {
      version: 1,
      note: 'UUIDs only \u2014 names live in the keychain, service commitwork-identity',
      identities: {},
    });
  });
});

test('a roster path that is a directory is refused as unreadable', () => {
  withRoster(undefined, (p, dir) => {
    assert.throws(() => loadRoster(env(dir)), {
      name: 'Error',
      message: `repo-identity: roster at ${dir} is unreadable (EISDIR); refusing to treat it as empty`,
    });
  });
});

test('a roster that is not JSON is refused with the parser message', () => {
  withRoster('not json', (p) => {
    assert.throws(() => loadRoster(env(p)), {
      name: 'Error',
      message: `repo-identity: roster at ${p} is not valid JSON (Unexpected token 'o', "not json" is not valid JSON); refusing to treat it as empty`,
    });
  });
});

test('a roster whose JSON is an array is refused as not an object', () => {
  withRoster('[]', (p) => {
    assert.throws(() => loadRoster(env(p)), {
      name: 'Error',
      message: `repo-identity: roster at ${p} is not an object`,
    });
  });
});

test('a roster whose JSON is a string or null is refused as not an object', () => {
  withRoster('"hello"', (p) => {
    assert.throws(() => loadRoster(env(p)), {
      name: 'Error',
      message: `repo-identity: roster at ${p} is not an object`,
    });
    writeFileSync(p, 'null');
    assert.throws(() => loadRoster(env(p)), {
      name: 'Error',
      message: `repo-identity: roster at ${p} is not an object`,
    });
  });
});

test('a roster whose identities is an array is refused as a non-object map', () => {
  withRoster(JSON.stringify({ identities: [] }), (p) => {
    assert.throws(() => loadRoster(env(p)), {
      name: 'Error',
      message: `repo-identity: roster at ${p} has a non-object 'identities' map`,
    });
  });
});

test('a roster whose identities is a number is refused as a non-object map', () => {
  withRoster(JSON.stringify({ identities: 7 }), (p) => {
    assert.throws(() => loadRoster(env(p)), {
      name: 'Error',
      message: `repo-identity: roster at ${p} has a non-object 'identities' map`,
    });
  });
});

test('a roster holding a key that is not a v4 UUID is refused naming that key', () => {
  withRoster(JSON.stringify({ identities: { [UUID]: {}, 'not-a-uuid': {} } }), (p) => {
    assert.throws(() => loadRoster(env(p)), {
      name: 'Error',
      message: `repo-identity: roster at ${p} holds "not-a-uuid", which is not a v4 UUID`,
    });
  });
});

test('a roster without an identities key gets an empty identities map', () => {
  withRoster(JSON.stringify({ version: 1 }), (p) => {
    assert.deepEqual(loadRoster(env(p)), { version: 1, identities: {} });
  });
});

test('a roster whose keys are all v4 UUIDs is returned unchanged', () => {
  withRoster(JSON.stringify({ version: 1, identities: { [UUID]: { name: 'x' } } }), (p) => {
    assert.deepEqual(loadRoster(env(p)), { version: 1, identities: { [UUID]: { name: 'x' } } });
  });
});

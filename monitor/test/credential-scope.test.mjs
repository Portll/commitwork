// node --test monitor/test/ — the credential-scope lens. The properties pinned hardest: an item
// under commitwork's namespace that no ref explains is THE finding; an item OUTSIDE the namespace
// never appears in any output (scope discipline — this lens must not inventory other parties'
// items); the sweep never touches values (the invocation itself is asserted); grey states
// (unswept, radius gaps) are partial, never ok and never findings.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseKeychainDump, sweepKeychain, assessCredentials, readScope, runLens,
} from '../credential-scope.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-cred-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

const DUMP = `keychain: "/Users/x/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="commitwork"
    "acct"<blob>="VELD_API_KEY"
    "svce"<blob>="commitwork"
keychain: "/Users/x/Library/Keychains/login.keychain-db"
class: "genp"
attributes:
    0x00000007 <blob>="mystery"
    "acct"<blob>="MYSTERY_TOKEN"
    "svce"<blob>="commitwork"
keychain: "/Users/x/Library/Keychains/login.keychain-db"
class: "genp"
attributes:
    0x00000007 <blob>="somebody else's"
    "acct"<blob>="THEIR_SECRET"
    "svce"<blob>="other-app"
keychain: "/Users/x/Library/Keychains/login.keychain-db"
class: "inet"
attributes:
    "acct"<blob>="user@example.com"
    "srvr"<blob>="example.com"
`;

const TABLE = { version: 1, secrets: { VELD_API_KEY: 'keychain:commitwork/VELD_API_KEY', GHOST: 'keychain:commitwork/GHOST' } };
const SCOPE = { namespaces: ['commitwork'], radius: { VELD_API_KEY: { system: 'memory-layer', grants: 'rw', leak: 'poisoning' } } };

describe('parseKeychainDump', () => {
  test('generic and internet items parse; blocks without account/service are dropped', () => {
    const items = parseKeychainDump(DUMP);
    assert.equal(items.length, 4);
    assert.deepEqual(items[0], { class: 'genp', service: 'commitwork', account: 'VELD_API_KEY', label: 'commitwork' });
    assert.deepEqual(items[3], { class: 'inet', service: 'example.com', account: 'user@example.com', label: null });
  });
});

describe('assessCredentials — the join', () => {
  const observed = parseKeychainDump(DUMP);

  test('declared + observed + radius = held; the radius rides the row', () => {
    const r = assessCredentials({ secrets: { VELD_API_KEY: 'keychain:commitwork/VELD_API_KEY' } }, SCOPE, observed);
    const internalC = r.rows.find((x) => x.name === 'VELD_API_KEY');
    assert.equal(internalC.state, 'held');
    assert.equal(internalC.radius.system, 'memory-layer');
  });

  test('an item under our namespace that no ref explains is THE finding', () => {
    const r = assessCredentials(TABLE, SCOPE, observed);
    assert.deepEqual(r.undeclared.map((u) => u.account), ['MYSTERY_TOKEN']);
    assert.ok(r.findings.some((f) => f.state === 'undeclared'));
    assert.equal(r.state, 'findings');
  });

  test('scope discipline: an item OUTSIDE the namespace appears in no output at all', () => {
    const r = assessCredentials(TABLE, SCOPE, observed);
    const everything = JSON.stringify(r);
    assert.ok(!everything.includes('THEIR_SECRET'), 'other parties’ items must never be inventoried');
    assert.ok(!everything.includes('other-app'));
  });

  test('declared but absent from the store is unresolvable — loud, a finding', () => {
    const r = assessCredentials(TABLE, SCOPE, observed);
    assert.equal(r.rows.find((x) => x.name === 'GHOST').state, 'unresolvable');
    assert.ok(r.findings.some((f) => f.state === 'unresolvable'));
  });

  test('declared + held with no radius row is the visible gap — grey, never ok, never a finding', () => {
    const table = { secrets: { MYSTERY_TOKEN: 'keychain:commitwork/MYSTERY_TOKEN', VELD_API_KEY: 'keychain:commitwork/VELD_API_KEY' } };
    const r = assessCredentials(table, SCOPE, observed);
    assert.equal(r.rows.find((x) => x.name === 'MYSTERY_TOKEN').state, 'radius-undeclared');
    assert.equal(r.state, 'partial');
    assert.deepEqual(r.findings, []);
  });

  test('an unswept store (adapter absent) leaves rows held-unswept and undeclared unknowable — partial, not ok', () => {
    const r = assessCredentials({ secrets: { VELD_API_KEY: 'keychain:commitwork/VELD_API_KEY' } }, SCOPE, null);
    assert.equal(r.rows[0].state, 'held-unswept');
    assert.equal(r.rows[0].unknownReason, 'not-run');
    assert.equal(r.undeclared, null, 'cannot claim "no undeclared items" over a store nobody swept');
    assert.equal(r.state, 'partial');
  });

  test('a declared name riding the environment is flagged, name only', () => {
    const r = assessCredentials({ secrets: { VELD_API_KEY: 'keychain:commitwork/VELD_API_KEY' } }, SCOPE, observed, new Set(['VELD_API_KEY']));
    assert.equal(r.rows[0].envExposed, true);
  });
});

describe('the sweep', () => {
  test('the invocation is metadata-only — no -d, no -w, ever', () => {
    const calls = [];
    const exec = (cmd, args) => { calls.push([cmd, ...args]); return DUMP; };
    sweepKeychain({ platform: 'darwin', exec });
    assert.deepEqual(calls, [['security', 'dump-keychain']]);
  });

  test('a non-darwin platform returns null (adapter not written) rather than an empty inventory', () => {
    assert.equal(sweepKeychain({ platform: 'linux', exec: () => { throw new Error('must not exec'); } }), null);
  });

  test('CW_CRED_DUMP fixture bypasses exec entirely', async () => {
    const dir = scratch();
    const f = join(dir, 'dump.txt');
    writeFileSync(f, DUMP);
    await env({ CW_CRED_DUMP: f }, async () => {
      const items = sweepKeychain({ platform: 'linux', exec: () => { throw new Error('must not exec'); } });
      assert.equal(items.length, 4);
    })();
  });
});

describe('the lens end to end, on fixtures', () => {
  test('table × scope × dump, deterministic', async () => {
    const dir = scratch();
    const table = join(dir, 'secrets.json');
    const scope = join(dir, 'scope.json');
    const dump = join(dir, 'dump.txt');
    writeFileSync(table, JSON.stringify(TABLE));
    writeFileSync(scope, JSON.stringify(SCOPE));
    writeFileSync(dump, DUMP);
    await env({ CW_SECRETS_FILE: table, CW_CRED_SCOPE: scope, CW_CRED_DUMP: dump, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      const r = runLens();
      assert.equal(r.at, '2026-08-27T00:00:00.000Z');
      assert.equal(r.state, 'findings');   // GHOST unresolvable + MYSTERY_TOKEN undeclared
      assert.equal(r.findings.length, 2);
    })();
  });

  test('a malformed ref table THROWS through the lens — a typo is never an empty set', async () => {
    const dir = scratch();
    const table = join(dir, 'secrets.json');
    writeFileSync(table, '{broken');
    await env({ CW_SECRETS_FILE: table }, async () => { assert.throws(() => runLens()); })();
  });

  test('a sweep failure is unknown — never "no items"', async () => {
    const dir = scratch();
    const table = join(dir, 'secrets.json');
    const scope = join(dir, 'scope.json');
    writeFileSync(table, JSON.stringify(TABLE));
    writeFileSync(scope, JSON.stringify(SCOPE));
    await env({ CW_SECRETS_FILE: table, CW_CRED_SCOPE: scope, CW_CRED_DUMP: undefined }, async () => {
      const r = runLens({ platform: 'darwin', exec: () => { const e = new Error('locked'); e.code = 'EPERM'; throw e; } });
      assert.equal(r.unknown, true);
      assert.equal(r.unknownReason, 'tool-failed');
      assert.equal(r.rows, undefined);
    })();
  });
});

describe('the schema is applied, not merely listed', () => {
  test('an invalid scope REFUSES to load — never sweeps a namespace nobody declared', async () => {
    const dir = scratch();
    const scope = join(dir, 'scope.json');
    writeFileSync(scope, JSON.stringify({ namespaces: [], radius: { X: { system: 's', grants: 'g', leak: 'l' } } }));   // empty namespaces
    await env({ CW_CRED_SCOPE: scope }, async () => {
      assert.throws(() => readScope(), /invalid/);
    })();
  });
});

describe('the shipped scope file', () => {
  test('an absent scope is UNKNOWN (no-reference), never an empty pass', async () => {
    const dir = scratch();
    const table = join(dir, 'secrets.json');
    writeFileSync(table, JSON.stringify(TABLE));
    await env({ CW_SECRETS_FILE: table, CW_CRED_SCOPE: join(dir, 'absent.json') }, async () => {
      const r = runLens({ platform: 'darwin', exec: () => '' });
      assert.equal(r.unknown, true);
      assert.equal(r.unknownReason, 'no-reference');
      assert.equal(r.rows, undefined);
    })();
  });

  // The operator's scope is a private record; the example ships the shape.
  test('parses; namespaces non-empty; every radius row carries system, grants and leak', async () => {
    let s;
    await env({ CW_CRED_SCOPE: fileURLToPath(new URL('../credential-scope.example.json', import.meta.url)) }, async () => { s = readScope(); })();
    assert.ok(s.namespaces.includes('commitwork'));
    for (const [name, r] of Object.entries(s.radius)) {
      for (const field of ['system', 'grants', 'leak']) {
        assert.ok(typeof r[field] === 'string' && r[field].length, `${name}.${field}`);
      }
    }
  });
});

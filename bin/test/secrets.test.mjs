// lib/secrets.mjs — secrets by reference, and the loud void: a lookup that silently finds nothing
// must never be indistinguishable from an empty table. The keychain is exercised only where it
// can be done hermetically — no real credential is required or written.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRef, loadTable, saveTable, setRef, resolveRef, resolveInto, status, reportMissing, defaultRefFor } from '../../lib/secrets.mjs';

const scratch = () => join(mkdtempSync(join(tmpdir(), 'cw-secrets-')), 'secrets.json');

describe('refs', () => {
  test('a well-formed ref parses into service and account', () => {
    assert.deepEqual(parseRef('keychain:commitwork/VELD_API_KEY'),
      { backend: 'keychain', service: 'commitwork', account: 'VELD_API_KEY' });
    assert.equal(defaultRefFor('VELD_API_KEY'), 'keychain:commitwork/VELD_API_KEY');
  });

  test('a ref carrying shell metacharacters or whitespace is refused', () => {
    // these reach `security`'s argv. execFileSync uses no shell, so this is defence in depth —
    // but a ref that cannot be typed safely is a ref nobody meant to write.
    for (const bad of ['keychain:a b/c', 'keychain:a/b;rm -rf /', 'keychain:$(id)/x', 'keychain:a/b\nc',
      'keychain:/x', 'keychain:a/', 'env:FOO', 'FOO', '', null, 'keychain:a/b/c']) {
      assert.equal(parseRef(bad), null, `must refuse ${JSON.stringify(bad)}`);
    }
  });
});

describe('the ref table', () => {
  test('an ABSENT table is a legitimate empty — a box with no secrets is normal', () => {
    assert.deepEqual(loadTable(join(tmpdir(), `cw-absent-${Date.now()}.json`)), { version: 1, secrets: {} });
  });

  test('a MALFORMED table throws rather than reading as "nothing declared"', () => {
    // a typo in the pointer table must never be indistinguishable from an empty one
    const f = scratch();
    for (const [body, why] of [
      ['{ not json', 'corrupt JSON'],
      ['[]', 'a top-level array'],
      ['{"secrets":[]}', 'a non-object secrets map'],
      ['{"secrets":{"A":"not-a-ref"}}', 'an unparseable ref'],
    ]) {
      writeFileSync(f, body);
      assert.throws(() => loadTable(f), /secrets table/, why);
    }
  });

  test('the table holds POINTERS and is written 0600', () => {
    const f = scratch();
    setRef('VELD_API_KEY', 'keychain:commitwork/VELD_API_KEY', { file: f });
    const raw = readFileSync(f, 'utf8');
    assert.match(raw, /keychain:commitwork\/VELD_API_KEY/);
    assert.equal((statSync(f).mode & 0o777), 0o600, 'a pointer table is still not world-readable');
    assert.equal(loadTable(f).secrets.VELD_API_KEY, 'keychain:commitwork/VELD_API_KEY');
  });

  test('setRef refuses a name that is not an environment variable', () => {
    const f = scratch();
    for (const bad of ['lower', 'has-dash', '1LEADING', 'has space', '']) {
      assert.throws(() => setRef(bad, 'keychain:commitwork/X', { file: f }), /environment variable name/);
    }
  });
});

describe('resolution', () => {
  test('an UNREADABLE table throws instead of silently resolving nothing', () => {
    const f = scratch();
    saveTable({ version: 1, secrets: { A: 'keychain:commitwork/A' } }, f);
    chmodSync(f, 0o000);
    try { assert.throws(() => loadTable(f), /unreadable/); }
    finally { chmodSync(f, 0o600); }
  });

  test('an env var already set WINS and is reported as such', () => {
    // adopting this module must never take away a credential that works today
    const f = scratch();
    setRef('SOME_TOKEN', 'keychain:commitwork/SOME_TOKEN', { file: f });
    const r = resolveInto(['SOME_TOKEN'], { env: { SOME_TOKEN: 'from-env' }, file: f });
    assert.equal(r.env.SOME_TOKEN, 'from-env');
    assert.deepEqual(r.resolved, [{ name: 'SOME_TOKEN', source: 'env' }]);
    assert.equal(r.ok, true);
  });

  test('an empty env var does NOT win — it falls through to the ref', () => {
    const f = scratch();
    setRef('SOME_TOKEN', 'keychain:commitwork/definitely-absent-item', { file: f });
    const r = resolveInto(['SOME_TOKEN'], { env: { SOME_TOKEN: '' }, file: f });
    assert.equal(r.ok, false, 'an empty string is not a credential');
    assert.equal(r.missing[0].name, 'SOME_TOKEN');
  });

  test('an UNDECLARED name is missing with reason "undeclared", not silently skipped', () => {
    const f = scratch();
    const r = resolveInto(['NEVER_DECLARED'], { env: {}, file: f });
    assert.equal(r.ok, false);
    assert.equal(r.missing[0].reason, 'undeclared');
  });

  test('a declared-but-absent keychain item reports not-found, with the remedy', () => {
    const f = scratch();
    const ref = `keychain:commitwork/cw-test-absent-${Date.now()}`;
    setRef('ABSENT_ONE', ref, { file: f });
    const r = resolveInto(['ABSENT_ONE'], { env: {}, file: f });
    assert.equal(r.ok, false);
    if (process.platform === 'darwin') {
      assert.equal(r.missing[0].reason, 'not-found');
      assert.match(r.missing[0].detail, /bin\/secrets\.mjs set/, 'the reason must carry the fix');
    } else {
      assert.equal(r.missing[0].reason, 'unsupported-platform');
    }
  });

  test('resolveRef NEVER returns a value on failure', () => {
    const r = resolveRef(`keychain:commitwork/cw-test-absent-${Date.now()}`);
    assert.equal(r.ok, false);
    assert.equal('value' in r, false, 'a failed resolution must carry no value field at all');
  });
});

describe('the loud void', () => {
  test('reportMissing names the secret, the reason and the remedy', () => {
    const lines = [];
    const msg = reportMissing(
      [{ name: 'VELD_API_KEY', reason: 'not-found', detail: 'no keychain item commitwork/VELD_API_KEY' }],
      { context: 'the overwatch-layer export', logger: { error: (m) => lines.push(m) } },
    );
    assert.match(msg, /MISSING SECRET/);
    assert.match(msg, /VELD_API_KEY/);
    assert.match(msg, /not-found/);
    assert.match(msg, /the overwatch-layer export/);
    assert.match(msg, /bin\/secrets\.mjs set/, 'a complaint without a remedy trains people to ignore it');
    assert.equal(lines.length, 1, 'it must actually be logged, not merely returned');
  });

  test('nothing missing produces NO output — the void is loud, the success is quiet', () => {
    const lines = [];
    assert.equal(reportMissing([], { logger: { error: (m) => lines.push(m) } }), '');
    assert.equal(lines.length, 0);
  });
});

describe('status never leaks', () => {
  test('presence is reported without any value field', () => {
    const f = scratch();
    setRef('A_TOKEN', `keychain:commitwork/cw-test-absent-${Date.now()}`, { file: f });
    const rows = status({ file: f });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'A_TOKEN');
    assert.equal('value' in rows[0], false);
    assert.equal(JSON.stringify(rows).includes('value'), false, 'no value key anywhere in the report');
  });
});

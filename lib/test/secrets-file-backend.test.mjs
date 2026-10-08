// The `file:` ref backend — the one that works on the platform this repository is developed on.
//
// The negative controls come first, and they are the point: this backend's whole job is to hand a
// credential to a client, so the ways it must REFUSE matter more than the way it succeeds. A
// permission error read as "absent" turns a credential failure into a silent no-op, which is the
// single thing lib/secrets.mjs exists to prevent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRef, resolveRef, resolveInto, valueFromConfig, setRef, status, loadTable } from '../secrets.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'cw-secrets-file-'));
const cfg = join(scratch, 'config.toml');
writeFileSync(cfg, [
  '# a config another tool owns',
  'host = "127.0.0.1"',
  'api_key = "s3cr3t-value"',
  'bare_key = plain-value  # trailing comment',
  "single = 'quoted-value'",
  'empty_key = ""',
].join('\n'));

test('a ref that is not absolute is REFUSED, not resolved against some cwd', () => {
  assert.equal(parseRef('file:config.toml#api_key'), null);
  assert.equal(parseRef('file:./config.toml#api_key'), null);
  assert.equal(parseRef('file:../up/config.toml#api_key'), null);
  assert.deepEqual(parseRef('file:/etc/app/config.toml#api_key'),
    { backend: 'file', path: '/etc/app/config.toml', key: 'api_key' });
  assert.deepEqual(parseRef('file:C:\\Users\\x\\config.toml#api_key'),
    { backend: 'file', path: 'C:\\Users\\x\\config.toml', key: 'api_key' });
});

test('the keychain ref form still parses, and the two are told apart by backend', () => {
  assert.deepEqual(parseRef('keychain:commitwork/VELD_API_KEY'),
    { backend: 'keychain', service: 'commitwork', account: 'VELD_API_KEY' });
  assert.equal(parseRef('nonsense'), null);
  assert.equal(parseRef(''), null);
});

test('an absent file is `not-found`; a missing key is `no-key`; an empty value is `empty`', () => {
  // Three reasons, not one. Each demands a different action from an operator, and collapsing them
  // is how "the credential is absent" becomes indistinguishable from "the tool is misconfigured".
  const gone = resolveRef(`file:${join(scratch, 'nope.toml')}#api_key`);
  assert.equal(gone.ok, false);
  assert.equal(gone.reason, 'not-found');

  const noKey = resolveRef(`file:${cfg}#absent_key`);
  assert.equal(noKey.ok, false);
  assert.equal(noKey.reason, 'no-key');
  assert.match(noKey.detail, /exists but has no/);

  const empty = resolveRef(`file:${cfg}#empty_key`);
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'empty');
});

test('a directory where a file was expected is UNREADABLE, never absent', () => {
  const dir = join(scratch, 'a-directory');
  mkdirSync(dir, { recursive: true });
  const r = resolveRef(`file:${dir}#api_key`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unreadable', 'an IO error that is not ENOENT must not read as "absent"');
});

test('it can actually resolve — the positive control for the refusals above', () => {
  const r = resolveRef(`file:${cfg}#api_key`);
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.value, 's3cr3t-value');
});

test('the value shapes that occur in real config files', () => {
  assert.equal(valueFromConfig('api_key = "double"', 'api_key'), 'double');
  assert.equal(valueFromConfig("api_key = 'single'", 'api_key'), 'single');
  assert.equal(valueFromConfig('api_key=bare', 'api_key'), 'bare');
  assert.equal(valueFromConfig('api_key = bare  # why', 'api_key'), 'bare');
  assert.equal(valueFromConfig('api_key = "has # hash"', 'api_key'), 'has # hash',
    'a hash INSIDE quotes is part of the value, not a comment');
  assert.equal(valueFromConfig('other = 1', 'api_key'), null);
  assert.equal(valueFromConfig('my_api_key = "wrong"', 'api_key'), null,
    'a key that merely ENDS with the name is a different key');
});

test('resolveInto reports the backend that supplied the value, not a fixed one', () => {
  const table = { version: 1, secrets: { VELD_API_KEY: `file:${cfg}#api_key` } };
  const r = resolveInto(['VELD_API_KEY'], { env: {}, table });
  assert.equal(r.ok, true);
  assert.deepEqual(r.resolved.map((x) => ({ name: x.name, source: x.source })),
    [{ name: 'VELD_API_KEY', source: 'file' }],
    'reporting this as `keychain` would be a claim about its protection, and a false one');
  assert.equal(r.env.VELD_API_KEY, 's3cr3t-value');
});

test('an env var already set still wins, so a one-off overrides the file', () => {
  const table = { version: 1, secrets: { VELD_API_KEY: `file:${cfg}#api_key` } };
  const r = resolveInto(['VELD_API_KEY'], { env: { VELD_API_KEY: 'from-env' }, table });
  assert.equal(r.env.VELD_API_KEY, 'from-env');
  assert.equal(r.resolved[0].source, 'env');
});

test('an unresolvable file ref is MISSING, and the reason travels', () => {
  const table = { version: 1, secrets: { VELD_API_KEY: `file:${join(scratch, 'nope.toml')}#api_key` } };
  const r = resolveInto(['VELD_API_KEY'], { env: {}, table });
  assert.equal(r.ok, false);
  assert.equal(r.missing[0].reason, 'not-found');
  assert.equal(r.env.VELD_API_KEY, undefined, 'and no value is invented to keep the caller going');
});

test('the ref table round-trips a file ref, and status names its backend without a value', () => {
  const file = join(scratch, 'secrets.json');
  setRef('VELD_API_KEY', `file:${cfg}#api_key`, { file });
  assert.equal(loadTable(file).secrets.VELD_API_KEY, `file:${cfg}#api_key`);
  const rows = status({ file });
  assert.equal(rows[0].backend, 'file');
  assert.equal(rows[0].resolvable, true);
  assert.ok(!JSON.stringify(rows).includes('s3cr3t-value'), 'status must never carry the value');
});

test('a table holding an unparseable ref throws rather than reading as empty', () => {
  const file = join(scratch, 'bad.json');
  writeFileSync(file, JSON.stringify({ version: 1, secrets: { X: 'file:relative.toml#k' } }));
  assert.throws(() => loadTable(file), /unparseable ref/);
});

process.on('exit', () => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } });

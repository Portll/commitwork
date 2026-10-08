// bin/addsecret.mjs with a FAKE `security` first on PATH, so the macOS keychain is never touched:
// the fake logs its argv and answers add (exit 0/1) and find (a value, or 44 = not found) from env.
// The ref table is CW_SECRETS_FILE in tmp. Pins: the scope (explicit project, inferred from the
// cwd's git root, --global) and the service it maps to; the value never in argv or output; a ref
// recorded only after it reads back; a failed add or readback records nothing; usage exits 2.
// Before any run, the test proves PATH resolves `security` to the fake — never the real binary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(CW, 'bin', 'addsecret.mjs');
const DARWIN = process.platform === 'darwin';

const FAKE_SECURITY = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_SECURITY_LOG"
case "$1" in
  add-generic-password) exit "\${FAKE_ADD_EXIT:-0}" ;;
  find-generic-password)
    if [ -n "$FAKE_FIND_EXIT" ]; then echo "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain." >&2; exit "$FAKE_FIND_EXIT"; fi
    printf '%s\\n' "$FAKE_VALUE"; exit 0 ;;
esac
exit 1
`;

function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-addsecret-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'security'), FAKE_SECURITY); chmodSync(join(bin, 'security'), 0o755);
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin`, CW_SECRETS_FILE: join(dir, 'secrets.json'),
    FAKE_SECURITY_LOG: join(dir, 'security.log'),
    // built at run time so no credential-shaped literal sits in the tree
    FAKE_VALUE: ['fx', 'value', String(process.pid)].join('-') };
  // The guard this whole file stands on: `security` must resolve to the fake.
  const which = execFileSync('/bin/sh', ['-c', 'command -v security'], { env, encoding: 'utf8' }).trim();
  assert.equal(which, join(bin, 'security'), 'refusing to run: PATH would reach the real keychain tool');
  return { dir, env, table: env.CW_SECRETS_FILE, log: env.FAKE_SECURITY_LOG };
}

function run(s, args, { cwd, env = {} } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: cwd || s.dir, env: { ...s.env, ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const calls = (s) => (existsSync(s.log) ? readFileSync(s.log, 'utf8').trim().split('\n') : []);

test('<project> <NAME>: stored under commitwork.<project>, read back, then recorded — the value never shown', { skip: !DARWIN && 'keychain backend is macOS-only' }, (t) => {
  const s = sandbox(t);
  const r = run(s, ['ledger-batch', 'API_TOKEN']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^API_TOKEN → commitwork\.ledger-batch\/API_TOKEN\nscope: project ledger-batch\n/);
  assert.match(r.out, /✓ API_TOKEN → keychain:commitwork\.ledger-batch\/API_TOKEN\n {2}recorded in .*secrets\.json · verified readable · value not shown/);
  assert.deepEqual(calls(s), [
    'add-generic-password -a API_TOKEN -s commitwork.ledger-batch -U -w',
    'find-generic-password -w -s commitwork.ledger-batch -a API_TOKEN',
  ], 'the value is typed into `security`, never passed to it');
  assert.deepEqual(JSON.parse(readFileSync(s.table, 'utf8')), { version: 1, secrets: { API_TOKEN: 'keychain:commitwork.ledger-batch/API_TOKEN' } });
  assert.equal((r.out + r.err).includes(s.env.FAKE_VALUE), false, 'the read-back value reached the output');
});

test('one positional takes the project from the cwd\'s git root; --global takes none; odd characters are folded', { skip: !DARWIN && 'keychain backend is macOS-only' }, (t) => {
  const s = sandbox(t);
  const repo = join(s.dir, 'widget-repo'); mkdirSync(join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  const inferred = run(s, ['DB_URL'], { cwd: join(repo, 'src') });
  assert.equal(inferred.code, 0, inferred.err);
  assert.match(inferred.out, /^DB_URL → commitwork\.widget-repo\/DB_URL\nscope: project widget-repo\n/);

  const global = run(s, ['--global', 'SHARED_KEY'], { cwd: join(repo, 'src') });
  assert.equal(global.code, 0, global.err);
  assert.match(global.out, /^SHARED_KEY → commitwork\/SHARED_KEY\nscope: GLOBAL \(fleet-wide\)\n/);

  const folded = run(s, ['acme proj:x', 'OTHER']);
  assert.match(folded.out, /^OTHER → commitwork\.acme-proj-x\/OTHER\n/, "':' is the ref delimiter and cannot reach a service");

  assert.deepEqual(JSON.parse(readFileSync(s.table, 'utf8')).secrets, {
    DB_URL: 'keychain:commitwork.widget-repo/DB_URL',
    SHARED_KEY: 'keychain:commitwork/SHARED_KEY',
    OTHER: 'keychain:commitwork.acme-proj-x/OTHER',
  });
});

test('a failed `security` add records nothing and exits 1', { skip: !DARWIN && 'keychain backend is macOS-only' }, (t) => {
  const s = sandbox(t);
  const r = run(s, ['ledger-batch', 'API_TOKEN'], { env: { FAKE_ADD_EXIT: '1' } });
  assert.equal(r.code, 1);
  assert.match(r.err, /addsecret: security exited 1 — nothing was recorded\./);
  assert.equal(existsSync(s.table), false);
  assert.equal(calls(s).length, 1, 'no readback is attempted after a failed add');
});

test('a value that does not read back is NOT recorded — an unresolvable ref is a false green', { skip: !DARWIN && 'keychain backend is macOS-only' }, (t) => {
  const s = sandbox(t);
  writeFileSync(s.table, JSON.stringify({ version: 1, secrets: { KEEP: 'keychain:commitwork/KEEP' } }));
  const before = readFileSync(s.table, 'utf8');
  const r = run(s, ['ledger-batch', 'API_TOKEN'], { env: { FAKE_FIND_EXIT: '44' } });
  assert.equal(r.code, 1);
  assert.match(r.err, /stored, but it does not read back \(not-found: no keychain item commitwork\.ledger-batch\/API_TOKEN/);
  assert.match(r.err, /The ref was NOT recorded\./);
  assert.equal(readFileSync(s.table, 'utf8'), before);
});

test('no NAME is a usage error (exit 2) that never calls `security`', (t) => {
  const s = DARWIN ? sandbox(t) : null;
  const r = s ? run(s, []) : spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  const code = s ? r.code : r.status;
  const err = s ? r.err : r.stderr;
  assert.equal(code, 2);
  assert.match(err, /^usage: addsecret <NAME> \| addsecret <project> <NAME> \| addsecret --global <NAME>/);
  assert.match(err, /The VALUE is never an argument/);
  if (s) assert.deepEqual(calls(s), []);
});

test('off macOS it refuses before touching any store', { skip: DARWIN && 'covers the non-darwin refusal' }, () => {
  const r = spawnSync(process.execPath, [CLI, 'proj', 'NAME'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /addsecret: the keychain backend needs macOS/);
});

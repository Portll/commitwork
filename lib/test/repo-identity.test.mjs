// lib/test/repo-identity.test.mjs — the identity module, and the property that makes it worth having.
//
// The load-bearing assertion here is NOT that mint() returns a UUID. It is that the on-disk roster
// carries no client name, checked against monitor/release-redactions.json rather than against a
// list written here — a roster of names beside a manifest of names is the "mirrored" binding this
// repo already names as a defect, and only one of the two would bite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, statSync, existsSync } from 'node:fs';
import { redactionMapPathFor } from '../../monitor/store-paths.mjs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  mint, isIdentity, diffDigest, loadRoster, saveRoster, rosterPath, ledgerPath,
  identityRefFor, IDENTITY_SERVICE,
} from '../repo-identity.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scratch = () => mkdtempSync(join(tmpdir(), 'cw-identity-'));

test('mint returns a v4 UUID', () => {
  assert.ok(isIdentity(mint()));
});

// THE ANTI-DERIVATION PROPERTY. If the identity were hash(name) — which is the tidier-looking
// construction — then minting for the same repository twice would return the same value, and the
// identity domain here is small enough (12 redacted names, 7 live projects) that a wordlist
// recovers the whole map. Two mints differing is the observable form of "there is no way back
// except the vault".
test('minting is random, not derived — the same repository twice yields different identities', () => {
  const a = new Set(Array.from({ length: 64 }, () => mint()));
  assert.equal(a.size, 64, 'a collision in 64 mints means this is not random');
});

test('an absent roster is a legitimate empty (ENOENT only)', () => {
  const env = { CW_REPO_IDENTITY_ROSTER: join(scratch(), 'nope.json') };
  assert.deepEqual(loadRoster(env).identities, {});
});

test('a malformed roster FAILS CLOSED rather than reading as empty', () => {
  const p = join(scratch(), 'roster.json');
  writeFileSync(p, '{ not json');
  assert.throws(() => loadRoster({ CW_REPO_IDENTITY_ROSTER: p }), /not valid JSON/);
});

test('a roster holding a non-UUID key FAILS CLOSED — a hand edit must not sit beside a mint', () => {
  const p = join(scratch(), 'roster.json');
  writeFileSync(p, JSON.stringify({ version: 1, identities: { 'client-a': { since: 'x' } } }));
  assert.throws(() => loadRoster({ CW_REPO_IDENTITY_ROSTER: p }), /not a v4 UUID/);
});

test('the roster is written 0600 and round-trips', () => {
  const p = join(scratch(), 'roster.json');
  const env = { CW_REPO_IDENTITY_ROSTER: p };
  const id = mint();
  saveRoster({ version: 1, identities: { [id]: { since: '2026-09-07' } } }, env);
  assert.equal(statSync(p).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(loadRoster(env).identities), [id]);
});

// THE SECOND DIGEST. It covers the change alone, so it fails differently from a chain hash covering
// prev+record. A remote that sees only hashes needs both: one answers "was the lineage broken", the
// other "is the content what was recorded". A single digest serving both would let a replay that
// preserves lineage carry a matching content hash.
test('the diff digest is content-addressed and order-sensitive', () => {
  const a = diffDigest(null, { x: 1 });
  assert.equal(a, diffDigest(null, { x: 1 }), 'same change must give the same digest');
  assert.notEqual(a, diffDigest({ x: 1 }, null), 'direction must change the digest');
  assert.notEqual(a, diffDigest(null, { x: 2 }), 'content must change the digest');
});

// ─── THE PROPERTY THE WHOLE DESIGN EXISTS FOR ──────────────────────────────────────────────────
// The roster and the ledger are tracked, diffed and published. If either carried a client name the
// scheme would have bought nothing — it would be a second copy of the register with extra steps.
// The roster is checked against the release manifest rather than a list written here.
// The release manifest is a private store (monitor/store-paths.mjs); a public checkout skips and names it.
test('NO IDENTITY STORE CARRIES A CLIENT NAME', existsSync(redactionMapPathFor(REPO)) ? {} : { skip: `private release manifest absent at ${redactionMapPathFor(REPO)}` }, () => {
  const names = JSON.parse(readFileSync(redactionMapPathFor(REPO), 'utf8'))
    .names.filter((n) => n.scope === 'all').map((n) => n.name.toLowerCase());
  assert.ok(names.length, 'an empty roster of names would make this assertion vacuous');

  for (const p of [rosterPath({}), ledgerPath({})]) {
    let text;
    try { text = readFileSync(p, 'utf8').toLowerCase(); }
    catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const found = names.filter((n) => text.includes(n));
    assert.deepEqual(found, [], `${p} carries a client name — the identity store must hold UUIDs only`);
  }
});

test('the keychain ref names the identity service, not the credential one', () => {
  const id = mint();
  assert.equal(identityRefFor(id), `keychain:${IDENTITY_SERVICE}/${id}`);
  assert.notEqual(IDENTITY_SERVICE, 'commitwork', 'a grant over credentials must not be a grant over identities');
});

// Read at CALL time, never at module load: a `const X = process.env.Y` at import defeats the
// override for any test that sets it afterwards, so the test passes while proving nothing.
test('the roster path override is read at CALL time', () => {
  const a = join(scratch(), 'a.json');
  assert.equal(rosterPath({ CW_REPO_IDENTITY_ROSTER: a }), a);
  assert.notEqual(rosterPath({}), a);
});

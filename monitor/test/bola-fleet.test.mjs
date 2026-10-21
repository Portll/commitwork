// monitor/bola-fleet.mjs — the BOLA tab's data resolver.
//
// Pins the three properties the panel relies on:
//   · readiness is judged on DECLARED-or-SET secrets (env or a keychain ref), never by probing the
//     value — so the 8s-safe poll can't prompt for a keychain unlock, and a missing name is NAMED.
//   · latestEvidence is fail-closed: ENOENT ⇒ never run; unparseable ⇒ invalid; only a good file reads.
//   · CW_TARGET_URL is satisfied by an area's `base`, not treated as a missing credential.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bolaAreas, readiness, latestEvidence } from '../bola-fleet.mjs';

const BOLA_SECRETS = ['BOLA_PASS_A', 'BOLA_PASS_B', 'BOLA_PASS_ADMIN_A', 'BOLA_PASS_ADMIN_B'];

// Synthetic manifests, so readiness is judged against a fixture and never against whichever client
// manifest the tree bundles under a name that moves with the redaction map.
const MANIFESTS = mkdtempSync(join(tmpdir(), 'cw-bola-manifests-'));
const credential = (passwordEnv) => ({ type: 'keycloak', realm: 'fixture', client: 'fixture-web', username: 'x@example.test', passwordEnv });
writeFileSync(join(MANIFESTS, 'synthetic.json'), JSON.stringify({
  repo: 'synthetic keycloak target',
  actors: [
    { name: 'anon', role: 'anon' },
    { name: 'userA', role: 'user', tenant: 'tenantA', credential: credential('BOLA_PASS_A') },
    { name: 'userB', role: 'user', tenant: 'tenantB', credential: credential('BOLA_PASS_B') },
    { name: 'adminA', role: 'admin', tenant: 'tenantA', credential: credential('BOLA_PASS_ADMIN_A') },
    { name: 'adminB', role: 'admin', tenant: 'tenantB', credential: credential('BOLA_PASS_ADMIN_B') },
  ],
  objects: { model: 'seed', types: [{ name: 'thing', create: { path: '/api/things', body: {} }, idPath: 'id', getPath: '/api/things/{id}' }] },
}));
writeFileSync(join(MANIFESTS, 'synthetic-supabase.json'), JSON.stringify({
  repo: 'synthetic supabase target',
  auth: { origin: '${ENV:CW_TARGET_URL}', anonKeyEnv: 'BOLA_ANON_KEY' },
  actors: [{ name: 'anon', role: 'anon' }],
  objects: { model: 'seed', types: [] },
}));
process.env.CW_BOLA_MANIFEST_DIR = MANIFESTS;

test('bolaAreas returns only areas that declare a complete bola block', () => {
  const reg = { areas: [
    { slug: 'has', label: 'Has', out: 'has-out', bola: { manifest: 'synthetic', base: 'http://127.0.0.1:8080' } },
    { slug: 'partial', bola: { manifest: 'synthetic' } },          // no base → excluded
    { slug: 'none' },
  ] };
  const a = bolaAreas(reg);
  assert.equal(a.length, 1);
  assert.equal(a[0].slug, 'has');
  assert.equal(a[0].out, 'has-out');
  assert.equal(a[0].base, 'http://127.0.0.1:8080');
});

test('readiness is BLOCKED and NAMES the missing secrets when nothing is configured', () => {
  const area = { slug: 'sqx', manifest: 'synthetic', base: 'http://127.0.0.1:8080' };
  const r = readiness(area, { env: {}, table: { secrets: {} } });
  assert.equal(r.ready, false);
  assert.deepEqual(r.needed.sort(), [...BOLA_SECRETS].sort());
  assert.deepEqual(r.missing.map((m) => m.name).sort(), [...BOLA_SECRETS].sort());
  assert.match(r.reason, /not yet stored/);
});

test('readiness is READY when every secret resolves — from env OR a keychain ref', () => {
  const area = { slug: 'sqx', manifest: 'synthetic', base: 'http://127.0.0.1:8080' };
  const env = Object.fromEntries(BOLA_SECRETS.map((n) => [n, 'x']));
  assert.equal(readiness(area, { env, table: { secrets: {} } }).ready, true, 'all in env');
  const table = { secrets: Object.fromEntries(BOLA_SECRETS.map((n) => [n, `keychain:commitwork/${n}`])) };
  assert.equal(readiness(area, { env: {}, table }).ready, true, 'all declared in the keychain table');
});

test('CW_TARGET_URL is provided by the area base, not counted as a missing secret', () => {
  // A Supabase-style manifest reuses ${ENV:CW_TARGET_URL} as the auth origin (== base).
  const area = { slug: 'z', manifest: 'synthetic-supabase', base: 'http://127.0.0.1:54321' };
  const r = readiness(area, { env: {}, table: { secrets: {} } });
  assert.ok(!r.missing.some((m) => m.name === 'CW_TARGET_URL'), 'base satisfies CW_TARGET_URL');
  assert.ok(r.present.some((p) => p.name === 'CW_TARGET_URL' && p.source === 'base'));
});

test('readiness fails closed when the bundled manifest is missing', () => {
  const r = readiness({ slug: 'x', manifest: 'no-such-manifest', base: 'http://127.0.0.1:1' }, { env: {}, table: { secrets: {} } });
  assert.equal(r.ready, false);
  assert.match(r.reason, /missing/);
});

test('latestEvidence: ENOENT ⇒ never run; bad JSON ⇒ invalid; good file ⇒ parsed', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'cw-bolaev-'));
  try {
    const reg = { reportsRoot: tmp, areas: [{ slug: 'a', out: 'a' }] };
    assert.equal(latestEvidence('a', reg).present, false, 'no file yet');

    mkdirSync(join(tmp, 'a'), { recursive: true });
    writeFileSync(join(tmp, 'a', 'bola-latest.json'), '{ not json');
    const bad = latestEvidence('a', reg);
    assert.equal(bad.present, true);
    assert.equal(bad.invalid, true);

    const good = { generatedAt: '2026-08-02T00:00:00.000Z', summary: { verdict: 'POTENTIAL BOLA' },
      findings: [{ type: 'bola', severity: 'critical', path: '/x/1', attacker: 'userB', owner: 'userA' }],
      actors: [{ name: 'userA', role: 'user', tenant: 't1', minted: true }], voids: ['seed note for adminA: create POST failed'] };
    writeFileSync(join(tmp, 'a', 'bola-latest.json'), JSON.stringify(good));
    const ev = latestEvidence('a', reg);
    assert.equal(ev.present, true);
    assert.equal(ev.invalid, undefined);
    assert.equal(ev.findings.length, 1);
    assert.equal(ev.findings[0].type, 'bola');
    assert.equal(ev.actors.length, 1);
    assert.equal(ev.voids.length, 1);
    assert.equal(ev.generatedAt, '2026-08-02T00:00:00.000Z');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// bin/test/release-scope.test.mjs — the release name scope and matcher, on synthetic maps only.
//
// Both release-name gates import bin/lib/release-scope.mjs. These cases pin what a literal
// substring check missed (separator variants, a prefix class), what an over-eager one floods on (a
// short key inside advisory ids and hashes), and that every load failure refuses rather than
// shrinking the scope. Nothing here reads the private maps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildScope, findNames, locate, mask, normKey, withoutNames } from '../lib/release-scope.mjs';
import { loadDiskScope, loadScope } from '../lib/release-names-head-scan.mjs';

const RELEASE = {
  note: 'fixture',
  names: [
    { name: 'acme-labs', replacement: 'clientZ', scope: 'all', why: 'fixture' },
    { name: 'nimbus', replacement: 'layerZ', scope: 'prose', exempt: ['NIMBUS_'], why: 'fixture' },
  ],
  outOfScope: { ourselves: 'the subject of the repository', 'zq-': 'an earlier ruling left the prefix out' },
};
const PUBLISH = { map: { 'blue-heron': 'internalZ', qvx: 'internalY', ourselves: 'x' } };
const REGISTER = {
  identities: [
    { token: 'clientZ', repo_name: 'acme-labs', repo_aliases: ['AcmeLabsInc', 'zq-'], scope: 'all' },
    { token: 'layerZ', repo_name: 'nimbus', repo_aliases: [], scope: 'prose' },
  ],
  notInScope: [{ name: 'harmless', why: 'fixture' }],
};
const scope = () => buildScope({ release: RELEASE, publish: PUBLISH, identities: REGISTER });
const count = (text) => findNames(text, scope()).length;

test('withoutNames drops a name in every spelling and as a prefix, and nothing else', () => {
  const s = withoutNames(scope(), ['Acme_Labs', 'ZQ-']);
  assert.equal(findNames('acme-labs AcmeLabs zq-svc', s).length, 0);
  assert.equal(findNames('blue-heron AcmeLabsInc', s).length, 2);
  assert.notEqual(s.fingerprint, scope().fingerprint);
  assert.equal(withoutNames(scope(), []).fingerprint, scope().fingerprint);
});

test('separator variants and casings of a long name all match', () => {
  for (const s of ['acme-labs', 'acme_labs', 'AcmeLabs', 'ACME-LABS', 'a-c-m-e-l-a-b-s', 'acme.labs',
    'CW_ACMELABS', 'acmeLabsDir', 'path/to/acme-labs.json', 'blue_heron', 'BlueHeron']) {
    assert.equal(count(s), 1, `${s} must count once`);
  }
});

test('a long name written with one space matches, and only one space', () => {
  for (const s of ['acme labs', 'Acme Labs', 'blue heron']) assert.equal(count(s), 1, s);
  for (const s of ['acme  labs', 'acme\tlabs', 'acme\nlabs', 'acme', 'labs', 'no mention here']) assert.equal(count(s), 0, JSON.stringify(s));
});

test('a short name must stand as its own word or camelCase segment', () => {
  for (const s of ['qvx', "QVX's editor", 'CW_QVX', 'qvxDir', 'the qvx/shellLint lane']) assert.equal(count(s), 1, s);
  // the flood a bare substring produced: advisory ids and lockfile hashes
  for (const s of ['GHSA-3qvx-pm8x', 'GHSA-qvx9-h556', 'sha512-aQvXzz+', 'qvxy', 'aqvx']) assert.equal(count(s), 0, s);
});

test('a prefix alias catches the whole class, bare or completed, and nothing mid-word', () => {
  for (const s of ['zq-orders', 'zq-billing-api', 'ZQ_SERVICES', 'the zq-* set', "prefixes: ['zq-']"]) {
    assert.equal(count(s), 1, s);
  }
  for (const s of ['fzq-orders', 'zq', 'zqorders', 'a.zqx']) assert.equal(count(s), 0, s);
});

test('an exempt form on a prose entry does not hide an occurrence beside it', () => {
  assert.equal(count('NIMBUS_TASKS_DB'), 0);
  assert.equal(count('nimbus'), 1);
  assert.equal(count('NIMBUS_TASKS_DB and nimbus'), 1);
});

test('a prose exemption does not carry over to the same name scoped `all` elsewhere', () => {
  const s = buildScope({ release: RELEASE, publish: { map: { ...PUBLISH.map, nimbus: 'layerZ' } }, identities: REGISTER });
  assert.equal(findNames('NIMBUS_TASKS_DB', s).length, 1);
});

test('explicit exclusions are subtracted, except where the register scopes the same form', () => {
  const s = scope();
  assert.equal(count('ourselves'), 0, 'the manifest\'s outOfScope removes a publish-map key too');
  assert.equal(count('harmless'), 0);
  assert.equal(s.overridden, 1, 'the prefix is out of scope in the manifest and scope=all in the register');
  assert.ok(s.prefixes.some((p) => p.key === 'zq'), 'the register wins: the prefix stays in scope');
  assert.ok(!s.words.some((w) => w.key === normKey('nimbus') && w.source === 'identity-register'),
    'a prose-scoped register entry is not a scope=all name');
  assert.deepEqual(s.loaded, { 'release-manifest': 2, 'publish-map': 3, 'identity-register': 3 });
});

test('hits carry a line and a source, never the matched text; mask hides the span', () => {
  const text = 'line one\nsee acme_labs here\nand zq-orders there\n';
  const hits = findNames(text, scope());
  const where = locate(text, hits);
  assert.deepEqual(where, [
    { line: 2, source: 'release-manifest', kind: 'name' },
    { line: 3, source: 'identity-register', kind: 'prefix' },
  ]);
  assert.ok(!JSON.stringify(where).toLowerCase().includes('acme'), 'no matched text in a result');
  assert.equal(mask('services/acme-labs/x.json', findNames('services/acme-labs/x.json', scope())),
    'services/‹release-manifest›/x.json');
});

test('overlapping matches of two names count once', () => {
  assert.equal(count('AcmeLabsInc'), 1);
});

test('a malformed document refuses rather than shrinking the scope', () => {
  assert.throws(() => buildScope({ release: { names: [] }, publish: PUBLISH, identities: REGISTER }), /no names/);
  assert.throws(() => buildScope({ release: RELEASE, publish: {}, identities: REGISTER }), /no map/);
  assert.throws(() => buildScope({ release: RELEASE, publish: PUBLISH, identities: {} }), /no identities/);
});

function withEnv(vars, fn) {
  const was = {};
  for (const k of Object.keys(vars)) { was[k] = process.env[k]; if (vars[k] === null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally {
    for (const k of Object.keys(vars)) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; }
  }
}

test('the disk loader skips without a manifest and refuses a partial scope', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-release-scope-'));
  try {
    const rel = join(dir, 'release.json');
    const pub = join(dir, 'publish.json');
    const reg = join(dir, 'register.json');
    const env = { CW_RELEASE_REDACTIONS: rel, CW_PUBLISH_REDACTIONS: pub, CW_REPO_IDENTITIES: reg };
    assert.equal(withEnv(env, loadDiskScope), null, 'no manifest: a public checkout, which skips');
    writeFileSync(rel, JSON.stringify(RELEASE));
    assert.throws(() => withEnv(env, loadDiskScope), /publish map is unreadable/);
    writeFileSync(pub, JSON.stringify(PUBLISH));
    assert.throws(() => withEnv(env, loadDiskScope), /identity register is unreadable/);
    writeFileSync(reg, '{not json');
    assert.throws(() => withEnv(env, loadDiskScope), /not valid JSON/);
    writeFileSync(reg, JSON.stringify(REGISTER));
    assert.equal(withEnv(env, loadDiskScope).words.length, scope().words.length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the HEAD loader reads the sidecar COMMIT, skips with no sidecar, and refuses a partial one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-release-sidecar-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const noOverride = { CW_RELEASE_REDACTIONS: null, CW_SIDECAR: dir, CW_RELEASE_NAMES_HEAD_REF: null };
  try {
    assert.equal(withEnv({ ...noOverride, CW_SIDECAR: join(dir, 'absent') }, loadScope), null);
    git('init', '-q');
    mkdirSync(join(dir, 'monitor'));
    mkdirSync(join(dir, 'identity'));
    writeFileSync(join(dir, 'monitor', 'release-redactions.json'), JSON.stringify(RELEASE));
    writeFileSync(join(dir, 'monitor', 'publish-redactions.json'), JSON.stringify(PUBLISH));
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'two of three');
    // on disk but not committed: the whitewash reason, applied to the new document too
    writeFileSync(join(dir, 'identity', 'repo-identities.json'), JSON.stringify(REGISTER));
    assert.throws(() => withEnv(noOverride, loadScope), /repo-identities\.json is not in HEAD/);
    git('add', '.');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'three');
    assert.equal(withEnv(noOverride, loadScope).prefixes.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

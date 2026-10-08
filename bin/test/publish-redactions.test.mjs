// bin/test/publish-redactions.test.mjs — the second witness for the publish-boundary redaction.
//
// The redaction map (monitor/publish-redactions.json) is the first witness. It cannot check itself:
// a name that is never added to it is redacted zero times and the map reports success. So this file
// derives its roster from monitor/projects.json — the registry of what is actually scanned — and
// asserts the generated public pages contain none of it. The two witnesses share no input.
//
// Both directions are asserted separately, because only one of them lies to you. A cleanliness
// assertion that cannot fail is the failure mode this repo has already measured once: a guard that
// reported a clean tree it had never read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { redactForPublish, loadRedactions, redactionMapPath } from '../../lib/publish-redactions.mjs';
import { redactionMapPathFor, registryPathFor } from '../../monitor/store-paths.mjs';
import { loadRegistry, EXAMPLE_REGISTRY_PATH } from '../../monitor/registry.mjs';
import { privateRoot, docsiteRoot } from '../../lib/docsite-roots.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The operator's OWN projects are not customers; naming them publicly is correct, so they are
// excluded from the roster rather than from the assertion.
const OWN = new Set(['commitwork', 'memory-layer', 'internal-d', 'portll', 'external-a']);

function roster() {
  const names = new Set();
  const registry = loadRegistry({ quiet: true });
  for (const x of registry.projects || []) {
    for (const k of ['name', 'slug']) {
      const v = x && x[k];
      if (typeof v === 'string' && v && !OWN.has(v) && !v.startsWith('example-') && v !== 'someone-elses-repo') names.add(v);
    }
  }
  return [...names];
}

// taxonomy.html is a draft kept in the private docsite root; it is generated redacted all the same,
// because publishing it is a state change, so it stays under this check wherever it lives.
const PUBLIC_PAGES = [
  join(privateRoot() || docsiteRoot(), 'imported', 'taxonomy.html'),
  'docsite/imported/taxonomy-reference.html',
];

/** Every roster name a page carries, as `page: name` — the one detector both directions run. */
const offences = (pages, names) => Object.entries(pages).flatMap(([rel, body]) =>
  names.filter((n) => body.toLowerCase().includes(n.toLowerCase())).map((n) => `${rel}: ${n}`));

// The roster comes from the private fleet registry. Without it loadRegistry falls back to the shipped
// example, whose names are all placeholders, and the three tests below would pass over an empty
// roster — so they skip and name the registry, and the synthetic test after them keeps the detector
// running in every checkout.
const needsLiveRegistry = () => {
  const p = registryPathFor(REPO);
  try { statSync(p); return {}; } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { skip: `private fleet registry absent at ${p} (ENOENT) — the customer roster exists only where it does` };
  }
};

test('the roster is non-empty — an empty roster would make every assertion below vacuous', needsLiveRegistry(), () => {
  assert.ok(roster().length > 0, 'monitor/projects*.json yielded no customer names; this test would pass on anything');
});

test('NO GENERATED PUBLIC PAGE NAMES A CUSTOMER REPOSITORY', needsLiveRegistry(), () => {
  const pages = {};
  for (const rel of PUBLIC_PAGES) {
    const p = resolve(REPO, rel);
    if (existsSync(p)) pages[rel] = readFileSync(p, 'utf8');
  }
  const found = offences(pages, roster());
  assert.deepEqual(found, [], `customer names on a page generated for the public docsite:\n  ${found.join('\n  ')}`);
});

// The positive control. Without it the assertion above passes on an empty file, a missing file, or
// a roster that silently became empty — which is the same shape as the defect it exists to catch.
test('POSITIVE CONTROL: the same check FAILS when a customer name is present', needsLiveRegistry(), () => {
  const names = roster();
  const planted = { 'planted.html': `<html><body>a run in ${names[0]} went long</body></html>` };
  assert.notDeepEqual(offences(planted, names), [],
    'the detector did not fire on a planted customer name — it cannot be trusted when it reports clean');
});

// The roster and detector on a synthetic registry: the shipped example plus one fake customer and one
// of the operator's own projects, through the CW_REGISTRY override the live registry is read by.
test('on a synthetic registry the roster keeps the customer, drops the operator, and the detector fires', () => {
  const reg = JSON.parse(readFileSync(EXAMPLE_REGISTRY_PATH, 'utf8'));
  reg.areas.push({ slug: 'fixture-client', label: 'Fixture Client', out: 'fixture-client', members: ['acme-fixture-ltd', 'portll'] });
  for (const name of ['acme-fixture-ltd', 'portll']) {
    reg.projects.push({ name, area: 'fixture-client', path: `~/Repositories/${name}`, manifest: 'security-baseline' });
  }
  const f = join(mkdtempSync(join(tmpdir(), 'cw-roster-')), 'projects.json');
  writeFileSync(f, JSON.stringify(reg));
  const was = process.env.CW_REGISTRY;
  process.env.CW_REGISTRY = f;
  try {
    const names = roster();
    assert.deepEqual(names, ['acme-fixture-ltd'], 'placeholders and the operator\'s own projects stay out of the roster');
    assert.deepEqual(offences({ 'planted.html': '<p>a run in Acme-Fixture-Ltd went long</p>' }, names),
      ['planted.html: acme-fixture-ltd']);
    assert.deepEqual(offences({ 'clean.html': '<p>a run in client-fixture went long</p>' }, names), []);
  } finally {
    if (was === undefined) delete process.env.CW_REGISTRY; else process.env.CW_REGISTRY = was;
  }
});

test('redaction is applied longest-source-first, so a longer name is never left half-redacted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-redact-'));
  const f = join(dir, 'map.json');
  writeFileSync(f, JSON.stringify({ note: 'fixture', map: { 'acme': 'client-z', 'acme-libs': 'client-z-libs' } }));
  const env = { ...process.env, CW_PUBLISH_REDACTIONS: f };
  assert.equal(redactForPublish('acme-libs and acme', env), 'client-z-libs and client-z');
});

test('a malformed map FAILS CLOSED rather than publishing unredacted text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-redact-bad-'));
  const bad = join(dir, 'map.json');
  writeFileSync(bad, '{ not json');
  assert.throws(() => redactForPublish('client-a', { ...process.env, CW_PUBLISH_REDACTIONS: bad }), /refusing to publish unredacted/);
  const noMap = join(dir, 'nomap.json');
  writeFileSync(noMap, JSON.stringify({ note: 'no map key' }));
  assert.throws(() => redactForPublish('client-a', { ...process.env, CW_PUBLISH_REDACTIONS: noMap }), /refusing to publish unredacted/);
});

test('a map that violates its schema FAILS CLOSED, not just malformed JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-redact-schema-'));
  const f = join(dir, 'map.json');
  writeFileSync(f, JSON.stringify({ note: 'fixture', map: { 'ok name with spaces': 'client-z' } }));
  assert.throws(() => redactForPublish('x', { ...process.env, CW_PUBLISH_REDACTIONS: f }), /refusing to publish unredacted/);
});

// REVERSED 2026-09-09, deliberately. This asserted that an absent map is "legitimately absent" and
// returns no mappings — the ENOENT-is-the-only-real-absence rule, which is right for a STORE and
// wrong for a GUARD. A missing issue store genuinely means no issues yet. A missing redaction map
// does not mean nothing to redact; it means the publisher cannot tell whether it is about to
// disclose a client, and returning [] makes it publish in the clear while looking like it redacted.
//
// It became reachable the same day: the map moved out of the public tree, so anything still
// resolving the old path now finds nothing. Under the old contract that was a silent full
// disclosure; under this one it is a refusal with the path named.
test('an ABSENT map refuses to publish — absence is not "nothing to redact"', () => {
  const env = { ...process.env, CW_PUBLISH_REDACTIONS: join(tmpdir(), 'cw-does-not-exist-' + Date.now(), 'map.json') };
  assert.throws(() => loadRedactions(env), /is ABSENT at .* refusing to publish/);
  assert.throws(() => redactForPublish('untouched', env), /is ABSENT at .* refusing to publish/,
    'the text must NOT come back untouched — that is publication in the clear wearing the shape of a no-op');
});

test('the env override is read at CALL time, not at module load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-redact-late-'));
  const f = join(dir, 'map.json');
  writeFileSync(f, JSON.stringify({ note: 'fixture', map: { 'latename': 'client-late' } }));
  assert.equal(redactForPublish('latename', { ...process.env, CW_PUBLISH_REDACTIONS: f }), 'client-late');
});

// ─── MANIFEST PARITY ────────────────────────────────────────────────────────────────────────────
// Two manifests state one policy. monitor/release-redactions.json names WHO is in scope for the
// public release; monitor/publish-redactions.json is the map that actually RUNS at the docsite
// boundary. Nothing has ever joined them, so a name can be in scope for the release and absent
// from the map that redacts it — redacted zero times, with both files reporting success.
//
// This is the "mirrored binding" this repo already names as a defect: two statements of one truth,
// of which only one bites.

// Both maps are private stores: each is a reversal table, so neither ships. A public checkout has
// neither, and these two cross-checks cannot run there — they skip and name the path.
const relRedactions = () => JSON.parse(readFileSync(redactionMapPathFor(REPO), 'utf8'));
const pubMap = () => JSON.parse(readFileSync(redactionMapPath(), 'utf8')).map;
const privateMapsAbsent = () => [redactionMapPathFor(REPO), redactionMapPath()].find((f) => !existsSync(f));
const needsPrivateMaps = () => {
  const missing = privateMapsAbsent();
  return missing ? { skip: `private redaction map absent at ${missing} — public checkouts cannot run this cross-check` } : {};
};

test('every scope=all identity has a publish-boundary mapping', needsPrivateMaps(), () => {
  // scope 'prose' is deliberately excluded: those names are legitimate in some contexts (a module
  // path, an env var) and are judged per occurrence by the release gate. 'all' admits no such
  // reading — there is no context in which the docsite should carry one — so an 'all' name with no
  // mapping is a page waiting to publish it.
  const mapped = new Set(Object.keys(pubMap()).map((k) => k.toLowerCase()));
  const unmapped = relRedactions().names
    .filter((n) => n.scope === 'all')
    .map((n) => n.name)
    .filter((n) => !mapped.has(n.toLowerCase()));
  assert.deepEqual(unmapped, [],
    'in scope for the release, absent from the publish map — redactForPublish() will not touch these');
});

// ─── THE WITNESS MUST NOT READ ITS OWN OUTPUT ───────────────────────────────────────────────────
// roster() derives the customer names from monitor/projects.json, which is the point: a roster
// built from the redaction map could not catch a name the map forgot. That independence dies the
// moment the SOURCE registry is rewritten with the map's replacement values — the roster then holds
// post-redaction names, asserts that public pages do not contain them, and passes over a page
// naming the real repository. The vacuity guard above does not catch it, because the roster is not
// empty; it is full of the wrong names.
//
// The tell is exact and needs no judgment: a replacement VALUE from publish-redactions.json
// appearing on the SOURCE side of the system. A rename applied to the registry puts it there.
test('the registry holds no publish-redaction REPLACEMENT value — the witness reads sources, not its own output', needsPrivateMaps(), () => {
  const replacements = new Set(Object.values(pubMap()).map((v) => v.toLowerCase()));
  const declared = [...roster(), ...OWN];
  const leaked = declared.filter((n) => replacements.has(String(n).toLowerCase())).sort();
  assert.deepEqual(leaked, [],
    'the source registry carries redacted names, so this file\'s roster is post-redaction and cannot catch the real ones');
});

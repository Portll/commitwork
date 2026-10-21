// bin/test/release-names-head.test.mjs — the release name gate, asked of HEAD.
//
// WHY THIS EXISTS BESIDE release-names.test.mjs RATHER THAN REPLACING IT. That gate reads
// `git ls-files` for its population and `readFileSync` for its content — the INDEX and the WORKING
// TREE. Its header states the choice and the reason: "Reading HEAD would report the cleanup as
// undone for as long as it sat uncommitted, which on this tree is most of the time." That is a real
// cost and the objection is correct. It is not an oversight.
//
// But HEAD is what ships. The working-tree gate can pass while a pristine checkout of HEAD fails:
// a rename that exists on disk with its deletion staged and never committed leaves the identity in
// a tracked FILE PATH, and a release cut from HEAD would publish it under a green gate.
//
// A RATCHET IS THE SYNTHESIS. It removes the exact cost that argued against reading HEAD: the known
// remainder is baselined, so this is green and blocks nobody, while a NEW offender fails
// immediately. The floor only comes down. This is not a licence to bank another writer's
// half-landed work: every baselined entry must LEAVE the baseline as its rename lands, which the
// last test enforces.
//
// The matcher is no longer duplicated between the two gates: both import bin/lib/release-scope.mjs,
// so they cannot disagree about what a name is. The contract test below plants the forms a literal
// substring check missed, and bin/test/release-scope.test.mjs holds the matcher's own cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The scan lives in bin/lib/release-names-head-scan.mjs so the reseed tool can call it without
// importing this file — importing a file that calls test() registers its tests.
import {
  currentOffenders, loadBaseline, loadManifest, loadScope, headFiles, headRef, scanEntries,
  SIDECAR, MANIFEST_REL,
} from '../lib/release-names-head-scan.mjs';
import { buildScope, findNames, mask, offenderRows } from '../lib/release-scope.mjs';

// Offender lists name the file and line, masked to the source that scopes the hit: these messages
// reach logs, and printing the matched text would publish it.
const maskedPath = (p) => { const s = loadScope(); return s ? mask(p, findNames(p, s)) : p; };
// No sidecar and no override: a public checkout. The scans below would read an empty scope and
// pass over nothing, so they SKIP and say why instead.
const needsScope = () => (process.env.CW_RELEASE_REDACTIONS || existsSync(SIDECAR())
  ? {}
  : { skip: `no sidecar at ${SIDECAR()} — the release-name scope is private, so this gate cannot run here` });
const lines = (files) => { const d = currentOffenders().detail; return offenderRows(files.map((path) => ({ path, hits: d[path] || [] })), loadScope()); };

test('the guard can actually read HEAD — a skip must be loud, never a silent pass', (t) => {
  const files = headFiles();
  assert.ok(files.length > 100,
    `ls-tree ${headRef()} returned ${files.length} paths — HEAD is unreadable, and this gate has NOT run. `
    + 'An empty population is the one way a name gate reports clean without looking at anything.');
  const doc = loadManifest();
  // THE TWO ABSENCES ARE NOT THE SAME, and the repo's fail-closed rule is the one that separates
  // them: only a legitimately-absent input is allowed to be quiet. No sidecar means a PUBLIC
  // checkout, which the publication boundary requires to build and test without private records —
  // that is legitimate, and it skips loudly. A sidecar that is present but holds no committed
  // manifest is a BROKEN private checkout, and loadManifest() throws on it rather than returning
  // null, so that case never reaches here.
  if (doc === null) {
    t.diagnostic(`NOT EXERCISED: no sidecar at ${SIDECAR()}, so there is no identity list to enforce. `
      + 'A public checkout reaches this and must not read as a pass — nor as a failure it cannot fix.');
    return;
  }
  assert.ok(Array.isArray(doc.names) && doc.names.length > 0,
    'the redaction manifest names nobody — there is no scope to enforce');
  const scope = loadScope();
  assert.ok(scope && scope.words.length > 0, 'the three scope documents loaded to an empty scope');
});

test('the scan catches what a literal substring check missed — separator variants and a prefix class', () => {
  // Synthetic maps: the gate's contract, exercised without the private ones.
  const scope = buildScope({
    release: { names: [{ name: 'acme-labs', replacement: 'teamZ', scope: 'all', why: 'fixture' }] },
    publish: { map: { 'blue-heron': 'internalZ' } },
    identities: { identities: [{ token: 'teamZ', repo_name: 'acme-labs', repo_aliases: ['zq-'], scope: 'all' }] },
  });
  const r = scanEntries([
    { path: 'docs/a.md', text: 'planted: a-c-m-e-l-a-b-s\n' },
    { path: 'docs/b.md', text: 'clean line\nplanted: BlueHeron\n' },
    { path: 'docs/c.md', text: 'const svc = "zq-billing-api";\n' },
    { path: 'services/zq-orders/README.md', text: 'nothing here' },
    { path: 'docs/d.md', text: 'no mention here, not even acme alone' },
  ], scope);
  assert.deepEqual(r.content.map((c) => [c.path, c.hits.map((h) => h.line)]),
    [['docs/a.md', [1]], ['docs/b.md', [2]], ['docs/c.md', [1]]]);
  assert.deepEqual(r.paths, ['services/zq-orders/README.md']);
});

test('NO NEW tracked PATH at HEAD carries a redacted identity', needsScope(), () => {
  const base = new Set(loadBaseline().paths);
  const now = currentOffenders().paths;
  const added = now.filter((p) => !base.has(p));
  assert.deepEqual(added.map(maskedPath), [],
    'these FILE PATHS carry an identity the release must not publish, and are not in the baseline. '
    + 'A path is the most visible place a name can sit and a content scan passes it. Rename with '
    + '`git mv` and update every reference — do NOT add them to the baseline.');
});

test('NO NEW tracked CONTENT at HEAD carries a redacted identity', needsScope(), () => {
  const base = new Set(loadBaseline().content);
  const now = currentOffenders().content;
  const added = now.filter((p) => !base.has(p));
  assert.deepEqual(lines(added), [],
    'these files carry an identity in their HEAD content and are not in the baseline. The working-tree '
    + 'gate cannot see this: a cleanup that is applied but uncommitted reads as done there and ships here.');
});

test('the floor tightens — a path cleaned at HEAD cannot sit in the baseline forever', needsScope(), () => {
  const now = currentOffenders();
  const nowPaths = new Set(now.paths);
  const nowContent = new Set(now.content);
  const base = loadBaseline();
  const fixed = [
    ...base.paths.filter((p) => !nowPaths.has(p)).map((p) => `paths::${p}`),
    ...base.content.filter((p) => !nowContent.has(p)).map((p) => `content::${p}`),
  ];
  assert.deepEqual(fixed, [],
    'these baseline entries are CLEAN at HEAD and must be removed so the floor comes down with them. '
    + 'A ratchet that only ever holds is a permanent exemption wearing a ratchet\'s name.');
});

test('the manifest comes from the COMMIT, not the working tree', (t) => {
  // The false clean this pins: a population from `ls-tree HEAD` beside an exemption list from
  // `readFileSync` lets uncommitted exemptions suppress real offenders in committed content, and
  // the gate then reads differently in the working tree and in a pristine checkout of the same
  // commit. The manifest is the reversal table, so the publication boundary bars it from this
  // repository; it is committed in the sidecar instead. "Committed" is the requirement, wherever
  // the committed copy lives.
  if (!existsSync(SIDECAR())) {
    t.diagnostic(`NOT EXERCISED: no sidecar at ${SIDECAR()}, so there is no committed manifest to `
      + 'compare a working copy against. A public checkout reaches this and must not read as a pass.');
    return;
  }
  // LF-NORMALISED BEFORE COMPARING. Git for Windows checks out CRLF while `git show` returns the
  // blob's LF bytes, so on every Windows checkout these two strings differ while the manifests are
  // IDENTICAL. Unnormalised, this test would pass its "not exercised" guard into an assertion whose
  // premise ("they differ, so the source is decidable") is false, and fail a gate that is behaving
  // perfectly.
  const lf = (s) => s.split('\r\n').join('\n');
  const onDisk = lf(readFileSync(resolve(SIDECAR(), MANIFEST_REL), 'utf8'));
  const atHead = lf(execFileSync('git', ['-C', SIDECAR(), 'show', `HEAD:${MANIFEST_REL}`],
    { encoding: 'utf8', maxBuffer: 1 << 26 }));

  if (onDisk === atHead) {
    // NOT a pass. With a clean manifest the two sources are indistinguishable, so
    // this run proves nothing about which one was consulted.
    t.diagnostic('NOT EXERCISED: the manifest is identical on disk and at HEAD, so a gate reading '
      + 'either source would look the same here. This assertion needs a dirty manifest to mean anything.');
    return;
  }

  // They differ, so the source is decidable: what the scan loaded must be HEAD's.
  const loaded = JSON.stringify(loadManifest());
  assert.equal(loaded, JSON.stringify(JSON.parse(atHead)),
    'loadManifest() returned the working tree\'s manifest. A gate that reads HEAD for its population '
    + 'and the tree for its exemptions reports clean on offenders that are committed.');
  assert.notEqual(loaded, JSON.stringify(JSON.parse(onDisk)),
    'loadManifest() matched the on-disk manifest while the two differ — it is reading the tree.');
});

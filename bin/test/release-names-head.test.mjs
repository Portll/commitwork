// bin/test/release-names-head.test.mjs — the release name gate, asked of HEAD.
//
// WHY THIS EXISTS BESIDE release-names.test.mjs RATHER THAN REPLACING IT. That gate reads
// `git ls-files` for its population and `readFileSync` for its content — the INDEX and the WORKING
// TREE. Its header states the choice and the reason: "Reading HEAD would report the cleanup as
// undone for as long as it sat uncommitted, which on this tree is most of the time." That is a real
// cost and the objection is correct. It is not an oversight.
//
// But nothing was then asking HEAD, and HEAD is what ships. Measured 2026-09-01: the working-tree
// gate passed 5/5 while the same file run in a pristine `git worktree add --detach HEAD` failed
// both halves — four identities sitting in tracked FILE PATHS, because the renames existed on disk
// with their deletions staged and never committed. A release cut from HEAD would have published
// them under a green gate.
//
// A RATCHET IS THE SYNTHESIS. It removes the exact cost that argued against reading HEAD: the known
// remainder is baselined, so this is green today and blocks nobody, while a FIFTH offender fails
// immediately. The floor only comes down. This is not a licence to bank a co-author's half-landed
// work — the four below are a dated, named remainder of the anonymisation C3 programme, and every
// one of them must LEAVE the baseline as its rename lands, which the last test enforces.
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
  // checkout, which the 2026-09-07 boundary requires to build and test without private records —
  // that is legitimate, and it skips loudly. A sidecar that is present but holds no committed
  // manifest is a BROKEN private checkout, and loadManifest() throws on it rather than returning
  // null, so that case never reaches here. Verified by control 2026-09-12, both directions.
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
    release: { names: [{ name: 'acme-labs', replacement: 'clientZ', scope: 'all', why: 'fixture' }] },
    publish: { map: { 'blue-heron': 'internalZ' } },
    identities: { identities: [{ token: 'clientZ', repo_name: 'acme-labs', repo_aliases: ['zq-'], scope: 'all' }] },
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
  // The false clean this pins, measured 2026-09-02: the population came from
  // `ls-tree HEAD` while the exemption list came from `readFileSync`, so 21
  // uncommitted exemptions suppressed 10 real offenders in committed content. The
  // gate read 5/5 in the working tree and 4/1 in a pristine checkout of the same
  // commit — the two disagreeing is the only reason it was found.
  // BOTH SOURCES MOVED TO THE SIDECAR, 2026-09-12, and the property is unchanged. The manifest is
  // the reversal table, so the publication boundary bars it from this repository; it is committed in
  // the sidecar instead. "Committed" was always the requirement — commitwork's HEAD was only where
  // the committed copy happened to live.
  if (!existsSync(SIDECAR())) {
    t.diagnostic(`NOT EXERCISED: no sidecar at ${SIDECAR()}, so there is no committed manifest to `
      + 'compare a working copy against. A public checkout reaches this and must not read as a pass.');
    return;
  }
  // LF-NORMALISED BEFORE COMPARING. Git for Windows checks out CRLF while `git show` returns the
  // blob's LF bytes, so on every Windows checkout these two strings differ while the manifests are
  // IDENTICAL. That drove this test past its "not exercised" guard and into an assertion whose
  // premise — "they differ, so the source is decidable" — was false, and it then failed a gate that
  // was behaving perfectly. A false failure, which is the direction this repo treats as the more
  // expensive one, in the test written to catch a false clean.
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

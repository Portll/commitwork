// node --test monitor/test/ — I3: the mediator carrying a human `accept` into the issue ledger.
//
// WHY THIS EXISTS. `accepted` has been in CLOSED_AS since the store was written and has never been
// used, while monitor/annotations.json holds 5 `accept` records the issue store never saw. A
// false-positive rate needs a denominator of confirmed-true findings, and the only verdict a human
// has ever recorded is `refuted` (136 of them). The true-positive side is empty by DISCONNECTION.
//
// The tests that matter most here are the REFUSALS: a mediator that joined too eagerly would
// re-commit the fleet-wide-suppression defect annotation.schema.json already records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptIdentity, issueIdentity, planAcceptClosures } from '../accept-mediator.mjs';

const iss = (id, repo, key, state = 'open') => [id, { id, repo, state, source: { kind: 'finding', key } }];
const depKey = (repo, adv, pkg, path = 'file:///src/package-lock.json') => `f:${repo}|osv|${adv}|${pkg}|${path}`;
const accept = (repo, id, pkg, extra = {}) => ({ action: 'accept', repo, id, package: pkg, reason: 'dev-only chain', who: 'operator', at: '2026-07-18', ...extra });

// ---- identity ---------------------------------------------------------------------------------

test('identity is repo + advisory + package — never the path', () => {
  const a = issueIdentity({ source: { key: depKey('svc-admin-console', 'CVE-2026-33671', 'picomatch', 'file:///src/a/package-lock.json') } });
  const b = issueIdentity({ source: { key: depKey('svc-admin-console', 'CVE-2026-33671', 'picomatch', 'file:///src/b/yarn.lock') } });
  assert.deepEqual(a, b, 'a lockfile moving must not change what the finding IS');
  assert.deepEqual(a, { repo: 'svc-admin-console', advisory: 'CVE-2026-33671', pkg: 'picomatch' });
});

test('a key this cannot read returns null rather than a guess', () => {
  // `g:<repo>|<package>` is a real key form in the live store and is NOT advisory-keyed.
  assert.equal(issueIdentity({ source: { key: 'g:internal-d|picomatch' } }), null);
  assert.equal(issueIdentity({ source: { key: 'sc:commitwork|sastCodeql|js/request-forgery|admin/serve.mjs|566' } }), null,
    'a scanner-row key carries a rule, not an advisory — not this mediator\'s business');
  assert.equal(issueIdentity({ source: { key: null } }), null);
  assert.equal(issueIdentity({}), null);
});

// ---- the exact join ---------------------------------------------------------------------------

test('an accept closes the issue for the SAME repo, advisory and package', () => {
  const issues = Object.fromEntries([iss('ISS-1', 'svc-admin-console', depKey('svc-admin-console', 'CVE-2026-33671', 'picomatch'))]);
  const p = planAcceptClosures([accept('svc-admin-console', 'CVE-2026-33671', 'picomatch')], issues);
  assert.equal(p.exact.length, 1);
  assert.equal(p.exact[0].issueId, 'ISS-1');
  assert.match(p.exact[0].evidence, /operator/);
  assert.match(p.exact[0].evidence, /dev-only chain/, 'the human reason travels with the closure — a close without evidence is an assertion');
});

test('an ALREADY CLOSED issue is never re-closed', () => {
  const issues = Object.fromEntries([iss('ISS-1', 'r', depKey('r', 'CVE-1', 'p'), 'closed')]);
  assert.equal(planAcceptClosures([accept('r', 'CVE-1', 'p')], issues).exact.length, 0);
});

// ---- the refusals: these are the point --------------------------------------------------------

test('THE FLEET-WIDE SUPPRESSION REFUSAL: a different repo is a candidate, never a closure', () => {
  // Measured live 2026-08-26: CVE-2026-33671/picomatch is accepted in a client admin console and
  // OPEN in two other fleet repos. The acceptance reasoning is repo-scoped ("dev/build-only chain,
  // yarn-1 resolution") and may not transfer. Applying it across repos is the defect
  // annotation.schema.json records as having suppressed a CVE fleet-wide.
  const issues = Object.fromEntries([
    iss('ISS-INTERNAL-D', 'internal-d', depKey('internal-d', 'CVE-2026-33671', 'picomatch')),
    iss('ISS-PROJECT-B', 'project-b', depKey('project-b', 'CVE-2026-33671', 'picomatch')),
  ]);
  const p = planAcceptClosures([accept('svc-admin-console', 'CVE-2026-33671', 'picomatch')], issues);
  assert.equal(p.exact.length, 0, 'NOTHING may be closed across a repo boundary');
  assert.equal(p.crossRepo.length, 2, 'but both must be surfaced — silence would hide a real question');
  assert.match(p.crossRepo[0].why, /repo-scoped/);
});

test('an annotation with NO repo is a wildcard and is refused outright', () => {
  const issues = Object.fromEntries([iss('ISS-1', 'anything', depKey('anything', 'CVE-1', 'p'))]);
  const p = planAcceptClosures([{ action: 'accept', id: 'CVE-1', package: 'p', reason: 'x' }], issues);
  assert.equal(p.exact.length, 0);
  assert.equal(p.crossRepo.length, 1);
  assert.match(p.crossRepo[0].why, /wildcard, refused/,
    'an omitted repo once suppressed a CVE fleet-wide — it must never drive a closure');
});

test('only `accept` is carried — other verdicts are not this mediator\'s to move', () => {
  const issues = Object.fromEntries([iss('ISS-1', 'r', depKey('r', 'CVE-1', 'p'))]);
  for (const action of ['wont-fix', 'false-positive', 'resolved', 'note', 'incorrect-scan-result']) {
    const p = planAcceptClosures([{ action, repo: 'r', id: 'CVE-1', package: 'p', reason: 'x' }], issues);
    assert.equal(p.exact.length, 0, `${action} must not close an issue as accepted`);
  }
});

// ---- the zero is a fact, and says which kind of fact it is -------------------------------------

test('a zero yield is EXPLAINED, never left to be inferred as a broken join', () => {
  const issues = Object.fromEntries([
    iss('ISS-1', 'internal-d', depKey('internal-d', 'CVE-9', 'other')),
    iss('ISS-2', 'x', 'g:x|nokey'),                    // unreadable shape
  ]);
  const p = planAcceptClosures([accept('svc-admin-console', 'CVE-2026-33671', 'picomatch')], issues);
  assert.equal(p.exact.length, 0);
  assert.equal(p.report.unreadableKey, 1, 'keys the join could not read are COUNTED, never silently skipped');
  assert.match(p.report.note, /different repositories/);
  assert.equal(p.report.accepts, 1);
  assert.equal(p.report.openIssues, 1, 'the unreadable one is not counted as an open candidate');
});

test('NOT VACUOUS: the join does fire when the stores agree', () => {
  // Without this, every refusal test above would pass on a mediator that simply never matches.
  const issues = Object.fromEntries([iss('ISS-1', 'r', depKey('r', 'CVE-1', 'p'))]);
  const p = planAcceptClosures([accept('r', 'CVE-1', 'p')], issues);
  assert.equal(p.exact.length, 1, 'an always-refusing mediator would satisfy the refusal tests and be useless');
  assert.equal(p.report.exact, 1);
});

test('planning writes nothing — the operator is the adjudicator', () => {
  const issues = Object.fromEntries([iss('ISS-1', 'r', depKey('r', 'CVE-1', 'p'))]);
  const before = JSON.stringify(issues);
  planAcceptClosures([accept('r', 'CVE-1', 'p')], issues);
  assert.equal(JSON.stringify(issues), before, 'the plan is a proposal; applying it is a separate gated act');
});

test('acceptIdentity tolerates a malformed annotation without throwing', () => {
  assert.deepEqual(acceptIdentity(null), { repo: '', advisory: '', pkg: '' });
  assert.deepEqual(acceptIdentity({}), { repo: '', advisory: '', pkg: '' });
});

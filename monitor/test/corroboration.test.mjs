// Two engines seeing one CVE produced two unrelated rows, because `tool` is inside the finding
// key. Their agreement was structurally unrepresentable — and so was their disagreement, which is
// the half commitwork's pitch is actually about.
//
// The load-bearing constraint: this is a VIEW. It must never re-key a finding. Changing keyOf to
// merge analysts would make counts.born and counts.cleaned both read the whole corpus in one
// slice, auto-close every anchored issue, and render as a mass remediation — CLAUDE.md's named
// trap in a new dimension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agreementGroups, disputes } from '../corroboration.mjs';

const rollup = (repos, scannerFindings = {}) => ({ repos, scannerFindings });
const repo = (name, findings) => ({ [name]: { name, findings } });

test('two analysts on one place form ONE group — the whole point', () => {
  const { groups } = agreementGroups(rollup(
    repo('r', [{ tool: 'osv', id: 'CVE-1', package: 'grpc', severity: 'high' }]),
    { depsGo: [{ repo: 'r', id: 'CVE-1', package: 'grpc', sev: 'high' }] },
  ));
  assert.equal(groups.length, 1, 'one advisory in one package in one repo is one fact');
  assert.deepEqual(groups[0].analysts, ['depsGo', 'osv']);
  assert.equal(groups[0].agreement, 'corroborated');
});

test('a severity conflict is DISPUTED and the spread is named, not resolved away', () => {
  const { groups } = agreementGroups(rollup(
    repo('r', [{ tool: 'osv', id: 'GO-2026-5764', package: 'aws-sdk', severity: 'med' }]),
    { depsGo: [{ repo: 'r', id: 'GO-2026-5764', package: 'aws-sdk', sev: 'high' }] },
  ));
  const d = groups[0];
  assert.equal(d.agreement, 'disputed');
  assert.deepEqual(d.spread, ['high', 'med'], 'both readings survive');
  assert.equal(d.worst, 'high', 'the conservative reading is OFFERED, clearly as a choice');
  assert.deepEqual(d.severities, { osv: 'med', depsGo: 'high' },
    'and each analyst is still individually attributable');
});

test('`unknown` is not an opinion — it must not manufacture a dispute', () => {
  // osv reports `unknown` for most GO-* advisories while govulncheck rates them. Counting that as
  // disagreement inflated the dispute list from 11 to 40 on the real corpus: 29 phantom conflicts,
  // every one of them one analyst filling a gap the other left.
  const { groups } = agreementGroups(rollup(
    repo('r', [{ tool: 'osv', id: 'GO-1', package: 'x', severity: 'unknown' }]),
    { depsGo: [{ repo: 'r', id: 'GO-1', package: 'x', sev: 'med' }] },
  ));
  assert.equal(groups[0].agreement, 'complemented');
  assert.equal(groups[0].spread, undefined);
  assert.deepEqual(groups[0].severities, { depsGo: 'med' }, 'only the analyst with an opinion is recorded');
});

test('grouping excludes tool, path AND version — identity is PLACE', () => {
  const { groups } = agreementGroups(rollup(
    repo('r', [
      { tool: 'osv', id: 'CVE-1', package: 'pkg:npm/lodash@4.17.20', severity: 'high', path: 'a/package-lock.json' },
      { tool: 'npm', id: 'cve-1', package: 'lodash', severity: 'high', path: 'b/package-lock.json' },
    ]),
  ));
  assert.equal(groups.length, 1,
    'same repo, same advisory, same package = one fact, whichever tool, path or purl form found it');
  assert.deepEqual(groups[0].analysts, ['npm', 'osv']);
});

test('a proven call path is recorded — a corroboration carrying a proof is worth more', () => {
  const { groups, summary } = agreementGroups(rollup(
    repo('r', [{ tool: 'osv', id: 'GO-1', package: 'grpc', severity: 'high' }]),
    // Rows carry the TYPED field, as extractors.mjs really emits them. The fixture used to carry
    // only `message`, which quietly pinned a consumer that parsed the prose.
    { depsGo: [
      { repo: 'r', id: 'GO-1', package: 'grpc', sev: 'high', reachability: 'reachable', prover: 'govulncheck', proofKind: 'compiler-callgraph', message: 'REACHABLE — govulncheck traced a call path to the vulnerable symbol' },
      { repo: 'r', id: 'GO-2', package: 'other', sev: 'med', reachability: 'unproven', prover: 'govulncheck', proofKind: 'none', message: 'present, unproven — the module is imported but no call path was shown' },
    ] },
  ));
  const proven = groups.find((g) => g.id === 'GO-1');
  assert.deepEqual(proven.reachabilityProvenBy, ['depsGo']);
  const unproven = groups.find((g) => g.id === 'GO-2');
  assert.equal(unproven.reachabilityProvenBy, undefined, '"present, unproven" is NOT a proof');
  assert.equal(summary.withProvenReachability, 1);
});

test('the TYPED reachability decides, not the message text', () => {
  // A row whose prose says REACHABLE while its typed field says unproven must not count. Reading
  // the sentence instead of the field means a re-worded message silently zeroes every proof in the
  // lane — no test, no error, and a corroboration that quietly stops corroborating.
  const { groups, summary } = agreementGroups(rollup(
    repo('r', [{ tool: 'osv', id: 'GO-3', package: 'grpc', severity: 'high' }]),
    { depsGo: [{ repo: 'r', id: 'GO-3', package: 'grpc', sev: 'high', reachability: 'unproven',
      prover: 'govulncheck', proofKind: 'none',
      message: 'REACHABLE — govulncheck traced a call path to the vulnerable symbol' }] },
  ));
  assert.equal(groups.find((g) => g.id === 'GO-3').reachabilityProvenBy, undefined);
  assert.equal(summary.withProvenReachability, 0);
});

test('dep-scan contributes a proof only when it ADJUDICATED one', () => {
  const { groups } = agreementGroups(rollup({}, { depsReachability: [
    { repo: 'r', id: 'CVE-1', package: 'a', sev: 'high', reachability: 'exploitable' },
    { repo: 'r', id: 'CVE-2', package: 'b', sev: 'high', reachability: 'unadjudicated' },
  ] }));
  assert.ok(groups.find((g) => g.id === 'CVE-1').reachabilityProvenBy);
  assert.equal(groups.find((g) => g.id === 'CVE-2').reachabilityProvenBy, undefined,
    'unadjudicated is not a proof and must never be counted as one');
});

test('singleAnalystShare is published — the honest ceiling on the whole claim', () => {
  const { summary } = agreementGroups(rollup(
    repo('r', [
      { tool: 'osv', id: 'CVE-1', package: 'a', severity: 'high' },
      { tool: 'osv', id: 'CVE-2', package: 'b', severity: 'high' },
      { tool: 'osv', id: 'CVE-3', package: 'c', severity: 'high' },
    ]),
    { depsGo: [{ repo: 'r', id: 'CVE-1', package: 'a', sev: 'high' }] },
  ));
  assert.equal(summary.groups, 3);
  assert.equal(summary.single, 2);
  assert.equal(summary.singleAnalystShare, 0.6667,
    'a fleet that is mostly single-analyst has not been cross-examined, whatever its finding count says');
});

test('a finding with no advisory id forms no group rather than a junk one', () => {
  const { groups } = agreementGroups(rollup(repo('r', [{ tool: 'osv', package: 'a', severity: 'high' }])));
  assert.equal(groups.length, 0, 'a group needs a place AND an advisory; guessing either invents a fact');
});

test('disputes() returns only the rows worth a human first', () => {
  const r = rollup(
    repo('r', [
      { tool: 'osv', id: 'CVE-1', package: 'a', severity: 'high' },
      { tool: 'osv', id: 'CVE-2', package: 'b', severity: 'low' },
    ]),
    { depsGo: [{ repo: 'r', id: 'CVE-1', package: 'a', sev: 'med' }] },
  );
  const d = disputes(r);
  assert.equal(d.length, 1);
  assert.equal(d[0].id, 'CVE-1');
});

test('the view is PURE — the input rollup is not mutated and no key is rewritten', () => {
  const input = rollup(
    repo('r', [{ tool: 'osv', id: 'CVE-1', package: 'a', severity: 'high', key: 'r|osv|CVE-1|a|p' }]),
    { depsGo: [{ repo: 'r', id: 'CVE-1', package: 'a', sev: 'high' }] },
  );
  const before = JSON.stringify(input);
  agreementGroups(input);
  assert.equal(JSON.stringify(input), before,
    're-keying findings to merge analysts would read as the entire corpus dying and being reborn');
  assert.equal(input.repos.r.findings[0].key, 'r|osv|CVE-1|a|p', 'tool stays inside the finding key');
});

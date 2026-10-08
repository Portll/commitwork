// node --test bin/test/ — pin-actions: a pin refresher must never invent a pin it cannot verify.
//
// Pure-function coverage: parsing, major-constrained tag choice, the four states, and the
// rewrite. Network never runs here — the resolver's output is supplied as data, which is the
// same seam the CLI uses (planLine takes tags, or null for "the listing itself failed").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflow, newestTag, planLine, applyPlan, repoOf } from '../pin-actions.mjs';

const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40), SHA_C = 'c'.repeat(40);
const WF = [
  'jobs:',
  '  t:',
  '    steps:',
  `      - uses: actions/checkout@${SHA_A} # v4.2.2`,
  '      - uses: actions/setup-node@v4',
  '      - uses: ./local/composite',
  '      - uses: docker://alpine:3',
].join('\n');

test('parseWorkflow finds registry refs and skips local/docker uses', () => {
  const e = parseWorkflow(WF);
  assert.equal(e.length, 2);
  assert.deepEqual(e.map((x) => x.action), ['actions/checkout', 'actions/setup-node']);
  assert.equal(e[0].comment, 'v4.2.2');
});

// SUBPATH ACTIONS. Until 2026-09-06 the pattern required exactly one slash, so a
// `owner/repo/subpath@sha` line matched nothing and was reported as nothing — the file read clean
// while its two most security-relevant pins had never been looked at. The count is asserted as well
// as the contents, because the defect was an ENTRY THAT DID NOT EXIST: a test that only checked the
// entries it found would have passed throughout.
const WF_SUBPATH = [
  'jobs:',
  '  a:',
  '    steps:',
  `      - uses: github/codeql-action/init@${SHA_A} # v3.37.9`,
  `      - uses: github/codeql-action/analyze@${SHA_A} # v3.37.9`,
  `      - uses: actions/checkout@${SHA_B} # v4.4.0`,
  '      - uses: ./.github/actions/local-composite',
].join('\n');

test('a subpath action is parsed, not silently skipped', () => {
  const e = parseWorkflow(WF_SUBPATH);
  assert.equal(e.length, 3, 'a subpath pin that parses to nothing is a pin nobody verifies');
  assert.deepEqual(e.map((x) => x.action),
    ['github/codeql-action/init', 'github/codeql-action/analyze', 'actions/checkout']);
  assert.equal(e[0].comment, 'v3.37.9');
});

test('a local composite action with a subpath is still skipped', () => {
  // Widening the pattern to accept subpaths also let `./.github/actions/x` through the shape test.
  // It is excluded by the leading-dot guard, not by the shape — so the guard is asserted directly,
  // because the thing that used to exclude it (too few slashes) no longer does.
  assert.ok(!parseWorkflow(WF_SUBPATH).some((x) => x.action.startsWith('.')),
    'a local composite action has no registry tags and must never be resolved against github.com');
});

test('tags are resolved against the REPOSITORY, not the subpath', () => {
  // github.com/github/codeql-action/init has no tags — it is not a repository. Resolving the full
  // path would 404 and fail closed to UNVERIFIABLE: safe, and permanently useless, which is its own
  // way of never checking a pin.
  assert.equal(repoOf('github/codeql-action/init'), 'github/codeql-action');
  assert.equal(repoOf('github/codeql-action'), 'github/codeql-action');
  assert.equal(repoOf('actions/checkout'), 'actions/checkout');
});

test('newestTag prefers the qualified release over the bare moving major', () => {
  const best = newestTag([['v4', SHA_B], ['v4.3.0', SHA_B], ['v3.9.9', SHA_A]], 4);
  assert.equal(best.tag, 'v4.3.0', 'the bare tag IS the mutability being pinned');
});

test('a pin at the newest sha of its declared major is CURRENT; a newer major does not force it', () => {
  const tags = [['v4.2.2', SHA_A], ['v5.0.0', SHA_C]];
  const p = planLine(parseWorkflow(WF)[0], tags);
  assert.equal(p.state, 'CURRENT', 'major bumps are a review, not a refresh');
});

test('a pin behind its major is STALE with the target named; --write rewrites sha AND comment', () => {
  const tags = [['v4.2.2', SHA_A], ['v4.3.0', SHA_B]];
  const p = planLine(parseWorkflow(WF)[0], tags);
  assert.equal(p.state, 'STALE');
  assert.equal(p.to.sha, SHA_B);
  const out = applyPlan(WF, [p]).split('\n')[3];
  assert.equal(out, `      - uses: actions/checkout@${SHA_B} # v4.3.0`);
});

test('a mutable tag ref is UNPINNED and resolves within its own major', () => {
  const tags = [['v4.4.0', SHA_B], ['v5.0.0', SHA_C]];
  const p = planLine(parseWorkflow(WF)[1], tags);
  assert.equal(p.state, 'UNPINNED');
  assert.equal(p.to.tag, 'v4.4.0', 'v4 must not silently become v5');
});

test('a failed tag listing is UNVERIFIABLE — never CURRENT, never silently skipped', () => {
  const p = planLine(parseWorkflow(WF)[0], null);
  assert.equal(p.state, 'UNVERIFIABLE');
  assert.equal(p.to, undefined, 'no rewrite may be planned from a listing that failed');
});

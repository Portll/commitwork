// The pinning transform and the dependabot lane are the deterministic core the fleet can own without
// a scanner: pinning fails OPEN on an unresolved lookup (a wrong SHA is worse than an unpinned tag),
// is idempotent, and leaves local/docker refs alone; the dependabot merge never reformats a
// hand-authored config out from under its author.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinUses, ensureDependabotActions, unpinnable, addPersistCredentials } from '../workflow-harden.mjs';

const SHA = { 'actions/checkout': { v4: '11d5960a326750d5838078e36cf38b85af677262' },
              'aws-actions/configure-aws-credentials': { v4: '7474bc4690e29a8392af63c5b98e7449536d5c3a' } };
const resolve = (a, r) => SHA[a]?.[r] || null;

test('pins a tagged action to its SHA with the tag kept as a comment', () => {
  const { text, pinned } = pinUses('      - uses: actions/checkout@v4\n', resolve);
  assert.match(text, /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4/);
  assert.equal(pinned.length, 1);
});

test('handles the plain (non-dash) form too', () => {
  const { text } = pinUses('        uses: aws-actions/configure-aws-credentials@v4\n', resolve);
  assert.match(text, /configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a # v4/);
});

test('is idempotent — an already-pinned line is left alone', () => {
  const line = '      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\n';
  const { text, pinned } = pinUses(line, resolve);
  assert.equal(text, line);
  assert.equal(pinned.length, 0);
});

test('fails OPEN: an unresolved action is left unpinned, not blanked or guessed', () => {
  const { text, pinned, skipped } = pinUses('      - uses: some/unknown-action@v1\n', resolve);
  assert.match(text, /some\/unknown-action@v1/);
  assert.equal(pinned.length, 0);
  assert.equal(skipped[0].reason, 'unresolved');
});

test('leaves local actions and docker images alone', () => {
  assert.equal(unpinnable('./.github/actions/build', 'x'), 'local-action');
  assert.equal(unpinnable('docker://alpine', '3.20'), 'docker-image');
  const { pinned } = pinUses('      - uses: ./.github/actions/build\n      - uses: docker://alpine:3.20\n', resolve);
  assert.equal(pinned.length, 0);
});

test('does not touch non-uses lines', () => {
  const src = '        with:\n          ref: ${{ github.sha }}\n';
  assert.equal(pinUses(src, resolve).text, src);
});

test('persist-credentials: added to a checkout with no with: block', () => {
  const { text, changed } = addPersistCredentials('      - uses: actions/checkout@v4\n      - run: make\n');
  assert.equal(changed, 1);
  assert.match(text, /with:\n {10}persist-credentials: false/);
});

test('persist-credentials: MERGES into an existing with: block — never a second with: (the PR#4 bug)', () => {
  const src = [
    '      - uses: actions/checkout@abc # v4',
    '        with:',
    '          ref: ${{ github.sha }}',
    '',
  ].join('\n');
  const { text, changed } = addPersistCredentials(src);
  assert.equal(changed, 1);
  assert.equal((text.match(/with:/g) || []).length, 1, 'exactly one with: key');
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /ref: \$\{\{ github\.sha \}\}/);      // existing key preserved
});

test('persist-credentials: idempotent — already set is left alone', () => {
  const src = '      - uses: actions/checkout@abc # v4\n        with:\n          persist-credentials: false\n';
  const { text, changed } = addPersistCredentials(src);
  assert.equal(changed, 0);
  assert.equal(text, src);
});

test('persist-credentials: only touches actions/checkout, not other uses', () => {
  const { changed } = addPersistCredentials('      - uses: actions/setup-node@v4\n');
  assert.equal(changed, 0);
});

test('dependabot: creates a fresh config when none exists', () => {
  const { text, added } = ensureDependabotActions('');
  assert.equal(added, true);
  assert.match(text, /version: 2/);
  assert.match(text, /package-ecosystem: "github-actions"/);
});

test('dependabot: idempotent — an existing github-actions lane is untouched', () => {
  const cur = 'version: 2\nupdates:\n  - package-ecosystem: "github-actions"\n    directory: "/"\n';
  const { text, added } = ensureDependabotActions(cur);
  assert.equal(added, false);
  assert.equal(text, cur);
});

test('dependabot: appends the lane under an existing updates: list without reformatting', () => {
  const cur = 'version: 2\nupdates:\n  - package-ecosystem: "npm"\n    directory: "/"\n';
  const { text, added } = ensureDependabotActions(cur);
  assert.equal(added, true);
  assert.match(text, /package-ecosystem: "npm"/);        // original preserved verbatim
  assert.match(text, /package-ecosystem: "github-actions"/);
});

test('action names are matched in linear time (the segment regex backtracked exponentially)', () => {
  const action = '0/' + '--/'.repeat(40) + '!';
  const ms = Math.min(...[0, 1, 2].map(() => { const t = performance.now(); unpinnable(action, 'v1'); return performance.now() - t; }));
  assert.ok(ms < 250, `unpinnable took ${ms.toFixed(1)}ms`);
  assert.equal(unpinnable(action, 'v1'), 'unrecognised');
  assert.equal(unpinnable('actions/checkout/sub.dir', 'v4'), null, 'owner/repo/path still pins');
});

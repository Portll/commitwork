// What stops a remediation PR before it opens, and what records it afterwards: opt-out detection
// (marker file, CONTRIBUTING sentence, label, unreadable), the duplicate search, the caps, CLA and
// DCO detection, the event types the schema must accept, and the later merge or close.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { gitSeams } from '../draft-pr-live.mjs';
import { join } from 'node:path';
import { appendIssueEvent, loadIssues, verifyChain } from '../issue-store.mjs';
import { optOut, optOutSentence, contributionRequirements, duplicatesOf, opensAsDraft } from '../draft-pr-gates.mjs';
import { PR_EVENT_TYPES, reconcilePrOutcomes, withLedger } from '../draft-pr-ledger.mjs';
import { openDraftRemediationPR } from '../remediation-draft-pr.mjs';
import { makeFixture, goStub, adv, AT } from './lib/draft-pr-fixture.mjs';

const F = makeFixture();
after(() => rmSync(F.TMP, { recursive: true, force: true }));
const policy = (draftPr = {}) => ({ mode: 'draft-pr', draftPr: { targets: ['own', 'upstream'], ready: 'never', maxOpenPerRepo: 1, maxOpenPerDay: 3, ...draftPr } });
const run = (slug, { pol = policy(), env = {}, store = F.store() } = {}) => {
  F.resetCalls();
  const r = openDraftRemediationPR(adv(slug), { policy: pol, headState: { fixed: false }, issues: { path: store.path }, env: F.env({ STUB_PERM: 'ADMIN', ...env }), seams: goStub() });
  return { r, store, last: loadIssues({ path: store.path }).events.at(-1) };
};
const opened = (url, upstream, at = AT) => (doc, id) => appendIssueEvent(doc, 'remediation-pr-opened', id, { advisory: 'GO-2026-0099', package: 'example.test/other', upstream, url, draft: true }, at);
const created = () => F.calls().some((a) => a[0] === 'pr' && a[1] === 'create');

test('opt-out sentences: a bot word beside a PR word and a refusal; ordinary contribution prose is not one', () => {
  for (const s of ['We do not accept automated pull requests.', 'Pull requests opened by bots will be closed without review.',
    'Please do not open AI-generated PRs.', 'No bot PRs, please.', 'We do not accept pull requests\nfrom bots or automated tools.']) {
    assert.ok(optOutSentence(s), s);
  }
  for (const s of ['PRs will not be merged unless automated tests pass.', 'We welcome pull requests.',
    'Dependabot opens automated pull requests weekly.', 'Run the automated checks before opening a PR.']) {
    assert.equal(optOutSentence(s), null, s);
  }
});

test('opt-out: a marker file, a CONTRIBUTING sentence or a label each opt out; files or labels that cannot be read are not a pass', () => {
  assert.equal(optOut({ files: { '.github/no-automated-prs': '' }, labels: [] }).optedOut, true);
  assert.equal(optOut({ files: { 'CONTRIBUTING.md': 'Bot pull requests will be closed.' }, labels: [] }).optedOut, true);
  assert.equal(optOut({ files: {}, labels: ['bug', 'no-bots'] }).optedOut, true);
  assert.equal(optOut({ files: { 'CONTRIBUTING.md': 'PRs welcome.' }, labels: ['bug'] }).optedOut, false);
  assert.equal(optOut({ files: null, labels: [] }).optedOut, null);
  assert.equal(optOut({ files: {}, labels: null }).optedOut, null);
});

test('through gh: an opted-out or unreadable repository gets no PR, and the reason is on the issue', () => {
  F.repo('tester/optout-file', { '.github/no-automated-prs': '' });
  F.repo('tester/optout-text', { 'CONTRIBUTING.md': '# Contributing\n\nWe do not accept automated pull requests.\n' });
  F.repo('tester/optout-label');
  const cases = [['tester/optout-file', {}, 'opted-out', /no-automated-prs is present/],
    ['tester/optout-text', {}, 'opted-out', /CONTRIBUTING\.md: "We do not accept automated pull requests\."/],
    ['tester/optout-label', { STUB_LABELS: '[{"name":"no-automated-prs"}]' }, 'opted-out', /label/],
    ['tester/optout-label', { STUB_LABELS_FAIL: '1' }, 'opt-out-unreadable', /label list could not be read/]];
  for (const [slug, env, reason, why] of cases) {
    const { r, last } = run(slug, { env });
    assert.equal(r.reason, reason, slug);
    assert.match(last.data.detail, why);
    assert.equal(created(), false);
  }
});

test('a contribution file that links outside the clone is unreadable, not absent', () => {
  const dir = join(F.TMP, 'linked');
  mkdirSync(dir);
  symlinkSync(join(F.TMP, 'gitconfig'), join(dir, 'CONTRIBUTING.md'));
  assert.equal(gitSeams(F.env()).readFiles(dir, ['CONTRIBUTING.md']), null);
  writeFileSync(join(dir, 'CODE.md'), 'x');
  rmSync(join(dir, 'CONTRIBUTING.md'));
  assert.deepEqual(gitSeams(F.env()).readFiles(dir, ['CONTRIBUTING.md', 'CODE.md']), { files: { 'CONTRIBUTING.md': null, 'CODE.md': 'x' }, workflows: [] });
});

test('dedupe: an open PR naming the advisory or the module, or an issue naming the advisory, already proposes it', () => {
  const a = adv('acme/x', { bump: { module: 'example.test/parent', from: 'v0.1.0', to: 'v0.2.0' } });
  assert.deepEqual(duplicatesOf(a, { prs: [{ url: 'u1', title: 'Bump example.test/parent from 0.1.0 to 0.2.0', body: '' }] }).map((d) => d.url), ['u1']);
  assert.deepEqual(duplicatesOf(a, { issues: [{ url: 'u2', title: 'GO-2026-0001 reachable', body: '' }] }).map((d) => d.kind), ['issue']);
  assert.deepEqual(duplicatesOf(a, { issues: [{ url: 'u3', title: 'example.test/dep is slow', body: '' }] }), [], 'an issue about the module that asks for no bump is not a proposal');
  assert.deepEqual(duplicatesOf(a, { prs: [{ url: 'u4', title: 'docs: typo', body: '' }] }), []);
});

test('through gh: a duplicate stops the PR and names it; a search that cannot be read stops it too', () => {
  F.repo('tester/dup');
  const dup = run('tester/dup', { env: { STUB_PR_SEARCH: '[{"number":3,"url":"https://github.test/tester/dup/pull/3","title":"chore(deps): bump example.test/dep to v1.2.0","body":""}]' } });
  assert.equal(dup.r.reason, 'already-proposed');
  assert.equal(dup.r.duplicates[0].url, 'https://github.test/tester/dup/pull/3');
  const searched = F.calls().filter((a) => a[0] === 'pr' && a[1] === 'list').map((a) => a[a.indexOf('--search') + 1]);
  assert.deepEqual(searched, ['"GO-2026-0001"', '"example.test/dep"']);
  assert.equal(created(), false);
  assert.equal(run('tester/dup', { env: { STUB_SEARCH_FAIL: '1' } }).r.reason, 'dedupe-unreadable');
});

test('caps: open PRs on the repository and PRs opened today are counted from the ledger, before any gh call', () => {
  const repoCap = run('acme/capped', { store: F.store([opened('https://github.test/acme/capped/pull/1', 'acme/capped')]) });
  assert.equal(repoCap.r.reason, 'cap-per-repo');
  assert.deepEqual(F.calls(), []);
  const dayCap = run('acme/capped', { pol: policy({ maxOpenPerDay: 1 }), store: F.store([opened('https://github.test/acme/other/pull/1', 'acme/other')]) });
  assert.equal(dayCap.r.reason, 'cap-per-day');
  const yesterday = run('acme/capped', { pol: policy({ maxOpenPerDay: 1 }), store: F.store([opened('https://github.test/acme/other/pull/1', 'acme/other', '2026-10-21T03:00:00.000Z')]) });
  assert.notEqual(yesterday.r.reason, 'cap-per-day', 'yesterday does not count against today');
  assert.equal(run('acme/capped', { pol: policy({ maxOpenPerRepo: 0 }) }).r.reason, 'cap-per-repo', 'a cap of zero opens nothing');
});

test('CLA and DCO detection read CONTRIBUTING, marker files and workflows; draft unless ready allows and nothing is asked', () => {
  assert.deepEqual(contributionRequirements({ files: { 'CONTRIBUTING.md': 'Sign the CLA first.' } }).cla, true);
  assert.equal(contributionRequirements({ files: {}, workflows: [{ path: '.github/workflows/cla.yaml', text: 'uses: contributor-assistant/github-action@v2' }] }).claWhy, '.github/workflows/cla.yaml');
  assert.equal(contributionRequirements({ files: { 'CONTRIBUTING.md': 'Commits need Signed-off-by.' } }).dco, true);
  assert.equal(contributionRequirements({ files: { 'CONTRIBUTING.md': 'Have fun.', '.github/dco.yml': 'x' } }).dcoWhy, '.github/dco.yml');
  assert.deepEqual(contributionRequirements({ files: { 'CONTRIBUTING.md': 'Include a changelog entry.' } }), { cla: false, claWhy: null, dco: false, dcoWhy: null, contributing: 'CONTRIBUTING.md' });
  assert.equal(opensAsDraft({ ready: 'never', target: 'own' }), true);
  assert.equal(opensAsDraft({ ready: 'own-only', target: 'own' }), false);
  assert.equal(opensAsDraft({ ready: 'own-only', target: 'upstream' }), true);
  assert.equal(opensAsDraft({ ready: 'own-only', target: 'own', asks: ['sign the CLA'] }), true);
});

test('every PR event type is one the issue schema accepts', () => {
  const schema = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'schema', 'issue.schema.json'), 'utf8'));
  const allowed = new Set(schema.properties.events.items.properties.type.enum);
  assert.deepEqual(PR_EVENT_TYPES.filter((t) => !allowed.has(t)), []);
});

test('reconcile: a merged PR records the merge and lodges a dep-upgrade fix; a closed one records the close; an open one nothing', () => {
  const store = F.store([opened('https://github.test/a/b/pull/1', 'a/b'), opened('https://github.test/a/b/pull/2', 'a/b'), opened('https://github.test/a/b/pull/3', 'a/b')]);
  const states = { 1: { state: 'MERGED', mergedAt: AT, mergedBy: 'maintainer' }, 2: { state: 'CLOSED', closedAt: AT }, 3: { state: 'OPEN' } };
  const seen = withLedger((doc) => reconcilePrOutcomes(doc, { view: (url) => states[url.split('/').pop()], at: AT }), { path: store.path });
  assert.deepEqual(seen.map((s) => s.state), ['MERGED', 'CLOSED', 'OPEN']);
  const doc = loadIssues({ path: store.path });
  assert.deepEqual(doc.events.slice(-3).map((e) => e.type), ['remediation-pr-merged', 'fix-authored', 'remediation-pr-closed']);
  assert.equal(doc.issues[store.issueId].fix.fixType, 'dep-upgrade');
  assert.equal(doc.issues[store.issueId].fix.who, 'maintainer');
  assert.deepEqual(verifyChain(doc), []);
  const again = withLedger((d) => reconcilePrOutcomes(d, { view: () => ({ state: 'MERGED' }), at: AT }), { path: store.path });
  assert.deepEqual(again.map((s) => s.url), ['https://github.test/a/b/pull/3'], 'a merged or closed PR is not asked about again');
});

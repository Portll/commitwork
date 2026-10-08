// taxonomy-structure.test.mjs — the structure page's arithmetic on fixtures whose answers are
// known, so the page's numbers over the real registry are readings and not decoration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { tokenize, tfidf, cosine, similarityMatrix, clusterOrder, permutationTest, evidenceDims, weightedKappa, firstPassScores, analyse, renderPage } from '../taxonomy-structure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'taxonomy-structure.mjs');

test('tokenize drops stopwords and numbers and stems lightly', () => {
  assert.deepEqual(tokenize('The guards were running against 3 records'), ['guard', 'runn', 'against']);
});

test('cosine: identical texts are 1, disjoint texts are 0, and the matrix is symmetric', () => {
  const v = tfidf([tokenize('exit status unread'), tokenize('exit status unread'), tokenize('citation resolves nowhere')]);
  assert.ok(Math.abs(cosine(v[0], v[1]) - 1) < 1e-9);
  assert.equal(cosine(v[0], v[2]), 0);
  const S = similarityMatrix(v);
  assert.equal(S[0][2], S[2][0]);
  assert.equal(S[1][1], 1);
});

test('cluster order puts the two near-duplicates adjacent and is deterministic', () => {
  const docs = ['alpha beta gamma', 'delta epsilon zeta', 'alpha beta gamma delta', 'eta theta iota'].map(tokenize);
  const S = similarityMatrix(tfidf(docs));
  const o1 = clusterOrder(S), o2 = clusterOrder(S);
  assert.deepEqual(o1, o2);
  assert.equal(Math.abs(o1.indexOf(0) - o1.indexOf(2)), 1, 'docs 0 and 2 share three tokens and must sit side by side');
});

test('permutation test: real clusters give a small p, shuffled labels give a large one, and p is never zero', () => {
  const docs = [];
  for (let i = 0; i < 6; i++) docs.push(tokenize(`apple orange banana fruit${i}`));
  for (let i = 0; i < 6; i++) docs.push(tokenize(`hammer chisel wrench tool${i}`));
  const S = similarityMatrix(tfidf(docs));
  const labels = ['F', 'F', 'F', 'F', 'F', 'F', 'T', 'T', 'T', 'T', 'T', 'T'];
  const r = permutationTest(S, labels, 500);
  assert.ok(r.within > r.between, 'within must exceed between on a clustered fixture');
  assert.ok(r.p <= 0.01, `p was ${r.p}`);
  assert.ok(r.p > 0, 'a permutation test never reports zero');
  const scrambled = permutationTest(S, ['F', 'T', 'F', 'T', 'F', 'T', 'F', 'T', 'F', 'T', 'F', 'T'], 500);
  assert.ok(scrambled.p > 0.2, `scrambled labels should not look clustered, p was ${scrambled.p}`);
  assert.equal(permutationTest(S, labels, 200).p, permutationTest(S, labels, 200).p, 'seeded: two runs agree');
});

test('evidence dimensions read what the text carries and nothing it does not', () => {
  const rich = { example: 'Fixed at c0ffee1 in bin/taxonomy-render.mjs on 2026-09-06; 12 of 199 rows. Measured by reporter #4, confirmed by reporter #9 and again by reporter #4.', scoreBasis: '' };
  const d = evidenceDims(rich, [/Fixed at/i]);
  assert.deepEqual([d.sha, d.path, d.date, d.count, d.actor, d.matcher, d.reporters, d.score], [true, true, true, true, true, true, 2, 5]);
  const bare = { example: 'Only a competing account can establish it.', scoreBasis: 'derived; no instance and no instrument' };
  const b = evidenceDims(bare, [/Fixed at/i]);
  assert.equal(b.score, 0);
  assert.equal(b.derived, true);
  assert.equal(b.reporters, 0);
  // a bare word is not a sha: 'deadbeef' has no digit, '1234567' has no letter
  assert.equal(evidenceDims({ example: 'deadbeef and 1234567', scoreBasis: '' }, []).sha, false);
});

test('weighted kappa: perfect agreement is 1, and the first-pass reader takes the FROM side of the first re-rate', () => {
  assert.equal(weightedKappa([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]), 1);
  assert.ok(weightedKappa([0, 0, 4, 4], [4, 4, 0, 0]) < 0, 'systematic reversal is below zero');
  const c = { closure: 3, gain: 2, scoreBasis: 'x RE-RATED 2026-09-06 by y: closure 4→3, gain 1→2. reason RE-RATED 2026-09-07 by z: closure 3→3, gain 2→2.' };
  assert.deepEqual(firstPassScores(c), { closure: 4, gain: 1 });
  assert.deepEqual(firstPassScores({ closure: 2, gain: 2, scoreBasis: 'never re-rated' }), { closure: 2, gain: 2 });
});

const fixture = () => ({
  version: 15, verifiedAgainst: 'fixture',
  families: [{ roman: 'I', prefix: 'C', name: 'False clean', key: 'false_clean', proposition: 'p' , test: 'A fixture membership test, long enough to satisfy the schema minimum length for a family test.'}, { roman: 'V', prefix: 'M', name: 'False measurement', key: 'false_measurement', proposition: 'p' , test: 'A fixture membership test, long enough to satisfy the schema minimum length for a family test.'}],
  scaleBounds: { closureMin: 0, closureMax: 4, gainMin: 0, gainMax: 4, fullyClosed: 4 },
  evidencePredicate: { matchers: ['\\bat [0-9a-f]{7}\\b'] },
  classes: [
    { id: 'C1', name: 'Absence rendered as success', predicate: 'A renderer maps a missing input onto a success token.', description: 'Missing reads as clean.', example: 'fixed at c0ffee1', scoreBasis: 'b', closure: 4, gain: 1, stpa: [{ loop: 'monitor', uca: 'unsafe', cause: 'feedback-missing' }], rca: [{ relation: 'same-defect-as', to: 'M1', basis: { doc: 'd', quote: 'q' } }] },
    { id: 'C2', name: 'Exit code with no subscriber', predicate: 'A module exits non-zero and no caller branches on it.', description: 'Nobody reads the status.', example: 'derived', scoreBasis: 'derived', closure: 3, gain: 2, stpa: [{ loop: 'monitor', uca: 'not-provided', cause: 'feedback-missing' }], rca: [{ relation: 'unassessed' }] },
    { id: 'M1', name: 'Wrong population', predicate: 'A renderer maps a missing input onto a success token for the wrong population.', description: 'Missing reads as clean over the wrong tree.', example: 'measured 12 of 30 on 2026-09-06', scoreBasis: 'RE-RATED 2026-09-06 by x: closure 4→3, gain 1→2. bin/x.mjs', closure: 3, gain: 2, stpa: [{ loop: 'monitor', uca: 'unsafe', cause: 'feedback-missing' }], rca: [{ relation: 'same-defect-as', to: 'C1', basis: { doc: 'd', quote: 'q' } }] },
  ],
});

test('analyse over a fixture: nearest neighbours, shared triple, edges, evidence and kappa come out as the fixture says', () => {
  const A = analyse(fixture(), { perms: 100 });
  assert.equal(A.n, 3);
  assert.equal(A.nearest.find((x) => x.id === 'C1').nn, 'M1', 'C1 and M1 share their predicate wording');
  assert.equal(A.nearest.find((x) => x.id === 'C1').offFamily, true);
  assert.equal(A.nearest.find((x) => x.id === 'C1').declared, true, 'the same-defect-as edge is declared');
  assert.equal(A.sharedTriples.length, 1);
  assert.deepEqual(A.sharedTriples[0].pairs.map((p) => `${p.a}-${p.b}`), ['C1-M1']);
  assert.equal(A.edges.length, 2);
  assert.equal(A.evidence.find((e) => e.id === 'C2').score, 0);
  assert.equal(A.evidence.find((e) => e.id === 'C1').matcher, true);
  assert.equal(A.kappa.changed, 1);
  assert.ok(A.perm.p > 0 && A.perm.p <= 1);
});

test('the page is self-contained, carries its data inline, and the CLI writes it', () => {
  const html = renderPage(fixture(), analyse(fixture(), { perms: 50 }));
  assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)="https?:/i, 'no CDN, file:// safe');
  assert.match(html, /<script id="data" type="application\/json">\{"n":3,/);
  assert.match(html, /same-defect-as: C1 → M1/);
  assert.match(html, /zero-evidence classes<\/div><div class="v">1</);
  const dir = mkdtempSync(join(tmpdir(), 'cw-struct-'));
  const reg = join(dir, 'r.json'); const out = join(dir, 'p.html');
  writeFileSync(reg, JSON.stringify(fixture()));
  const r = spawnSync(process.execPath, [CLI, '--json', reg, '--out', out, '--perms', '50'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /wrote .*p\.html — 3 classes/);
  assert.match(readFileSync(out, 'utf8'), /How the 3 classes relate/);
});

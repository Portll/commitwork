// node --test cra/test/ — the taint-frontier review loop: draft, decide, emit, verify.
// The sweeps are cra/test/fixtures/taint-frontier: `plain` and `modelled` are the same source scanned
// without and with the model row ["weird-db-client", "Member[raw].Argument[0]", "sql-injection"]
// (PROVENANCE.json). So the loop's last step is checked against a measured before and after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import * as R from '../frontier-review.mjs';
import { buildFrontier } from '../taint-frontier.mjs';
import { modelFiles } from '../../bin/codeql-model-pack.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FX = join(REPO, 'cra', 'test', 'fixtures', 'taint-frontier');
const CLI = join(REPO, 'bin', 'frontier-review.mjs');
const ROW = ['weird-db-client', 'Member[raw].Argument[0]', 'sql-injection'];
const JS = 'javascript-typescript';

const cli = (args, models) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, CW_CODEQL_MODELS: models } });
const store = () => mkdtempSync(join(tmpdir(), 'fr-models-'));
const call = (o) => ({ language: JS, file: 'a.js', line: 1, api: 'lib.f()', param: 'param 0', claimed: false, ...o });

test('a draft asks one question per language|api|argument, never per line, and only of UNCLAIMED calls', () => {
  // Arrange
  const calls = [call({ line: 3, source: 'location.search', sourceAt: { file: 'a.js', line: 1 } }), call({ file: 'b.js', line: 40, source: 'req.body' }), call({ claimed: true, api: 'lib.g()' }), call({ api: null })];
  // Act
  const r = R.mergeReview(null, 'fx', calls, 'sweep-1');
  // Assert
  assert.equal(r.entries.length, 1, 'two lines of one API are one question; a claimed call is already a finding; an unparsed one has no API to decide');
  assert.deepEqual(r.entries[0], {
    language: JS, api: 'lib.f()', param: 'param 0', calls: 2, files: ['a.js', 'b.js'], filesCut: null,
    sources: ['location.search', 'req.body'],
    sites: [{ file: 'a.js', line: 3, from: { file: 'a.js', line: 1, label: 'location.search' } }, { file: 'b.js', line: 40, from: null }], sitesCut: null,
    firstSeen: 'sweep-1', lastSeen: 'sweep-1', decision: null,
  });
});

test('a drafted worksheet carries the decision guide: the question, each choice\'s shape, and what it does', () => {
  // Act
  const r = R.mergeReview(null, 'fx', [call()], 'sweep-1');
  // Assert
  assert.deepEqual(Object.keys(r.guide), ['question', 'neutral', 'sink', 'summary', 'undecided']);
  for (const as of ['neutral', 'sink', 'summary']) {
    assert.equal(R.validateDecision(r.guide[as].shape).ok, true, `the ${as} example validates as written`);
  }
  assert.equal(r.guide.undecided.shape, null);
});

test('a site moved within its file refreshes the evidence and keeps the decision: the line is never the key', () => {
  // Arrange
  const first = R.mergeReview(null, 'fx', [call({ line: 3 })], 'sweep-1');
  first.entries[0].decision = { as: 'neutral', why: 'plumbing' };
  // Act
  const moved = R.mergeReview(first, 'fx', [call({ line: 30 })], 'sweep-2');
  // Assert
  assert.equal(moved.entries.length, 1);
  assert.deepEqual(moved.entries[0].sites, [{ file: 'a.js', line: 30, from: null }]);
  assert.deepEqual(moved.entries[0].decision, { as: 'neutral', why: 'plumbing' });
});

test('a re-draft keeps every decision and every entry the sweep did not see, and the same sweep writes the same bytes', () => {
  // Arrange
  const first = R.mergeReview(null, 'fx', [call(), call({ api: 'lib.h()' })], 'sweep-1');
  first.entries[0].decision = { as: 'neutral', why: 'plumbing' };
  // Act
  const second = R.mergeReview(first, 'fx', [call({ line: 99 })], 'sweep-2');
  const again = R.mergeReview(second, 'fx', [call({ line: 99 })], 'sweep-2');
  // Assert
  const f = second.entries.find((e) => e.api === 'lib.f()');
  assert.deepEqual(f.decision, { as: 'neutral', why: 'plumbing' });
  assert.deepEqual([f.firstSeen, f.lastSeen], ['sweep-1', 'sweep-2']);
  assert.equal(second.entries.find((e) => e.api === 'lib.h()').lastSeen, 'sweep-1', 'unseen this sweep: kept, not dropped');
  assert.equal(R.reviewText(again), R.reviewText(second), 'idempotent');
});

test('a decision validates or is named: neutral needs a reason, sink and summary need their model row', () => {
  // Act / Assert
  assert.deepEqual(R.validateDecision(null), { ok: true, as: null });
  assert.equal(R.validateDecision({ as: 'neutral', why: 'state setter' }).ok, true);
  assert.equal(R.validateDecision({ as: 'neutral' }).ok, false);
  assert.equal(R.validateDecision({ as: 'sink', row: ROW }).ok, true);
  assert.equal(R.validateDecision({ as: 'summary', row: ['p', 'Member[f].Argument[0]', 'ReturnValue', 'taint'] }).ok, true);
  assert.equal(R.validateDecision({ as: 'sink', kind: 'sql-injection' }).ok, false, 'a kind alone is not a row');
  assert.equal(R.validateDecision({ as: 'sink', row: ['only-one'] }).ok, false);
  assert.equal(R.validateDecision({ as: 'sink', row: ['a', ''] }).ok, false);
  assert.match(R.validateDecision({ as: 'safe' }).reason, /one of neutral, sink, summary/);
  assert.equal(R.validateDecision('neutral').ok, false);
});

test('a worksheet that cannot be used is never read as empty — only ENOENT is absent', () => {
  // Arrange
  const d = store();
  try {
    const bad = join(d, 'bad.json'); writeFileSync(bad, '{ not json');
    const old = join(d, 'old.json'); writeFileSync(old, JSON.stringify({ v: 0, entries: [] }));
    const hole = join(d, 'hole.json'); writeFileSync(hole, JSON.stringify({ v: 1, entries: [{ api: 'x' }] }));
    // Act / Assert
    assert.equal(R.readReview(join(d, 'none.json')).state, 'absent');
    assert.equal(R.readReview(bad).state, 'unparseable');
    assert.equal(R.readReview(old).state, 'invalid');
    assert.equal(R.readReview(hole).state, 'invalid');
    assert.equal(R.readReview(d).state, 'unreadable', 'a directory where the file should be');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('modelsYaml places the reviewer\'s rows, sorted and deduplicated, per library — and refuses when one decision is invalid', () => {
  // Arrange
  const review = { v: 1, repo: 'fx', entries: [
    { language: JS, api: 'b()', param: null, decision: { as: 'sink', row: ['p', 'Member[b].Argument[0]', 'sql-injection'] } },
    { language: JS, api: 'a()', param: null, decision: { as: 'sink', row: ROW } },
    { language: JS, api: 'a2()', param: null, decision: { as: 'sink', row: ROW } },
    { language: JS, api: 's()', param: null, decision: { as: 'neutral', why: 'plumbing' } },
    { language: 'python', api: 'q()', param: null, decision: { as: 'sink', row: ['q', 'Argument[0]', 'sql-injection'] } },
  ] };
  // Act
  const y = R.modelsYaml(review, 'javascript', [JS, 'javascript']);
  // Assert
  assert.equal(y.rows, 2, 'one row per distinct model, the python entry belongs to another pack');
  assert.ok(y.text.startsWith(R.GENERATED_HEADER));
  assert.match(y.text, /pack: codeql\/javascript-all\n\s+extensible: sinkModel/);
  assert.ok(y.text.indexOf('"p"') < y.text.indexOf('"weird-db-client"'), 'sorted');
  assert.equal(R.modelsYaml({ v: 1, entries: [review.entries[3]] }, 'javascript', [JS]), null, 'nothing decided as a model: no file');
  const broken = R.modelsYaml({ v: 1, entries: [...review.entries, { language: JS, api: 'z()', param: null, decision: { as: 'sink' } }] }, 'javascript', [JS]);
  assert.equal(broken.invalid.length, 1);
});

test('applyReview: neutral leaves the open count, a sink decision still unclaimed is flagged, an unusable worksheet keeps everything open', () => {
  // Arrange
  const f = buildFrontier({ dir: join(FX, 'plain') });
  const decided = (decision) => ({ fx: { state: 'ok', review: { v: 1, entries: [{ language: JS, api: 'weird-db-client.raw()', param: 'param 0', decision }] } } });
  // Act
  const neutral = R.applyReview(f, decided({ as: 'neutral', why: 'x' }));
  const sink = R.applyReview(f, decided({ as: 'sink', row: ROW }));
  const broken = R.applyReview(f, { fx: { state: 'unparseable', reason: 'r' } });
  const after = R.applyReview(buildFrontier({ dir: join(FX, 'modelled') }), decided({ as: 'sink', row: ROW }));
  // Assert
  assert.deepEqual([neutral.totals.open, neutral.totals.neutral], [0, 1]);
  assert.deepEqual([sink.totals.open, sink.totals.sinkOpen], [1, 1], 'decided, but the sweep ran without the model: still open, and said so');
  assert.equal(broken.repos.fx.calls[0].review, 'review-unparseable');
  assert.equal(broken.totals.open, 1);
  assert.deepEqual([after.totals.claimed, after.totals.sinkOpen, after.totals.open], [1, 0, 0], 'measured: with the model applied the call is claimed, and the loop is closed');
});

test('the CLI loop on the measured fixture: draft, decide, emit a pack bin/codeql-model-pack.mjs loads, status', () => {
  // Arrange
  const models = store();
  try {
    // Act — draft
    const d1 = cli(['draft', join(FX, 'plain')], models);
    const path = join(models, 'fx', 'frontier-review.json');
    const text1 = readFileSync(path, 'utf8');
    const d2 = cli(['draft', join(FX, 'plain')], models);
    // Assert
    assert.equal(d1.status, 0, d1.stderr);
    assert.equal(d2.status, 0, d2.stderr);
    assert.equal(readFileSync(path, 'utf8'), text1, 'a second draft of the same sweep writes the same bytes');
    const review = JSON.parse(text1);
    assert.deepEqual(review.entries.map((e) => [e.api, e.param, e.decision]), [['weird-db-client.raw()', 'param 0', null]]);
    assert.equal(cli(['emit'], models).status, 0);
    assert.equal(existsSync(join(models, 'fx', 'frontier-javascript.yml')), false, 'nothing decided, nothing emitted');

    // Act — decide and emit
    review.entries[0].decision = { as: 'sink', row: ROW };
    writeFileSync(path, R.reviewText(review));
    const e = cli(['emit'], models);
    // Assert
    assert.equal(e.status, 0, e.stderr);
    const files = modelFiles(models, 'fx', JS);
    assert.deepEqual(files.map((f) => f.name), ['frontier-javascript.yml'], 'the pack builder loads the emitted file and never the worksheet');
    assert.ok(files[0].text.includes(JSON.stringify(ROW)));
    const st = JSON.parse(cli(['status', join(FX, 'plain')], models).stdout);
    assert.deepEqual([st.totals.open, st.totals.sinkOpen], [1, 1]);
    assert.equal(st.byRepo.fx.sinkOpenCalls[0].api, 'weird-db-client.raw()');
    const closed = JSON.parse(cli(['status', join(FX, 'modelled')], models).stdout);
    assert.deepEqual([closed.totals.claimed, closed.totals.open], [1, 0]);

    // Act — the decision is withdrawn: the tool removes only its own file
    review.entries[0].decision = { as: 'neutral', why: 'fixture' };
    writeFileSync(path, R.reviewText(review));
    writeFileSync(join(models, 'fx', 'frontier-python.yml'), 'extensions: []\n');
    assert.equal(cli(['emit'], models).status, 0);
    // Assert
    assert.equal(existsSync(join(models, 'fx', 'frontier-javascript.yml')), false);
    assert.equal(existsSync(join(models, 'fx', 'frontier-python.yml')), true, 'a hand-written file under a generated name is never removed');
  } finally { rmSync(models, { recursive: true, force: true }); }
});

test('the CLI fails closed: an unparseable worksheet is neither redrafted nor emitted from, and an invalid decision writes nothing', () => {
  // Arrange
  const models = store();
  try {
    mkdirSync(join(models, 'fx'));
    const path = join(models, 'fx', 'frontier-review.json');
    writeFileSync(path, '{ half');
    // Act
    const d = cli(['draft', join(FX, 'plain')], models);
    const e = cli(['emit'], models);
    // Assert
    assert.equal(d.status, 1);
    assert.match(d.stderr, /unparseable/);
    assert.equal(readFileSync(path, 'utf8'), '{ half', 'the decisions it may hold are not overwritten');
    assert.equal(e.status, 1);
    // Arrange — a decision without its row
    writeFileSync(path, R.reviewText({ v: 1, repo: 'fx', entries: [{ language: JS, api: 'weird-db-client.raw()', param: 'param 0', decision: { as: 'sink', kind: 'sql-injection' } }] }));
    // Act
    const bad = cli(['emit'], models);
    // Assert
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /model row/);
    assert.equal(existsSync(join(models, 'fx', 'frontier-javascript.yml')), false);
    assert.equal(cli(['draft'], models).status, 2, 'usage');
  } finally { rmSync(models, { recursive: true, force: true }); }
});

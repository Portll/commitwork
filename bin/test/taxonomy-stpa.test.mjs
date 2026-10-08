// taxonomy-stpa.test.mjs — the stpa axis is read from the registry's vocabulary, never restated,
// and a class the registry has not classified is refused by the validator AND the store.
// Runs on a FIXTURE registry written here (CW_TAXONOMY_JSON points the CLI at it), so the real
// registry's state — which may or may not carry stpa yet — decides nothing below except in the one
// test that says so by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, MSG_NO_VOCABULARY } from '../taxonomy-db.mjs';
import { validate } from '../taxonomy-render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_CLI = resolve(HERE, '..', 'taxonomy-db.mjs');
const RENDER_CLI = resolve(HERE, '..', 'taxonomy-render.mjs');
const REGISTRY = resolve(HERE, '..', '..', 'monitor', 'failure-taxonomy.json');

const t = (s) => ({ test: s });
const VOCAB = {
  loops: {
    operator: { controller: 'the operator', controls: 'fleet configuration, manifests, rulings, schedules', test: 'The controller is the operator acting on configuration.' },
    monitor: { controller: 'the monitor', controls: 'sweeps, the issue store, rollups, pages', test: 'The controller is the monitor acting on its own runs and stores.' },
    scanner: { controller: 'a scanner lane', controls: 'its own run over a repository', test: 'The controller is one scanner lane over one repository.' },
    agent: { controller: 'an agent session', controls: 'the working tree and the ledgers', test: 'The controller is an agent session acting on the tree.' },
    oversight: { controller: 'hooks, gates and overwatch-layer', controls: 'the agent', test: 'The controller is a hook or gate acting on the agent.' },
    attention: { controller: 'the monitor\'s publication', controls: 'operator attention', test: 'The controller is publication, and what it allocates is attention.' },
  },
  uca: {
    'not-provided': t('A required action was never issued.'),
    unsafe: t('The action was issued and was wrong for the state.'),
    'too-early': t('The action was issued before its precondition held.'),
    'too-late': t('The action was issued after it could still take effect.'),
    'out-of-order': t('The action was issued in the wrong sequence.'),
    'stopped-too-soon': t('A continuous action ended before its goal.'),
    'applied-too-long': t('A continuous action outlived its goal.'),
    none: t('The class describes no control action in this loop.'),
  },
  cause: {
    'controller-algorithm': t('The rule the controller applies is wrong.'),
    'controller-model': t('The controller\'s model of the process is wrong.'),
    'higher-input': t('A higher controller supplied a wrong instruction.'),
    'actuator-delayed': t('The actuator acted late.'),
    'actuator-missing': t('No actuator exists for the action.'),
    'actuator-corrupt': t('The actuator acted, and changed the wrong thing.'),
    'process-failure': t('The controlled process failed outright.'),
    'process-change': t('The controlled process changed shape.'),
    'process-disturbance': t('An external disturbance moved the process.'),
    'feedback-missing': t('No signal reached the controller.'),
    'feedback-delayed': t('The signal reached the controller late.'),
    'feedback-incorrect': t('The signal reached the controller wrong.'),
    'sensor-inadequate': t('The sensor cannot observe the property.'),
    'coordination-conflict': t('Two controllers issued conflicting actions.'),
    'coordination-gap': t('Each controller believed the other would act.'),
    'coordination-duplicate': t('Two controllers issued the same action.'),
  },
};
const PROVENANCE = { rater: 'one reader', date: '2026-08-23', method: 'from class text', caveat: 'single rater; unreviewed' };

const RCA_VOCAB = {
  symmetries: { none: { test: 'names no target' } },
  relations: { unassessed: { symmetry: 'none', terminal: true, test: 'fixture' } },
};

// rca defaults to unassessed: this file's subject is the stpa axis, and a fixture that silently
// omitted the rca axis would fail validate() for a reason that has nothing to do with what it tests.
const cls = (id, machine, closure, gain, stpa, rca = [{ relation: 'unassessed' }]) => ({
  id, name: `Class ${id}`, machine, layer: 'CTRL', description: `d ${id}`, analogy: `a ${id}`, example: `e ${id}`,
  predicate: `A fixture predicate for ${id}, deliberately long enough to satisfy the schema minimum.`,
  closure, gain, scoreBasis: 'fixture', stpa, rca,
});

// Narrow reading (loop != attention, uca in not-provided/too-late): C2, K2.
// Wide reading (any loop): C2, K1, K2. C1 is closed and carries `none` in its own loop.
// Not exported: importing a test file registers its tests in the importer's process and runs
// them twice. taxonomy-db.test.mjs carries its own minimal graft for the same reason.
const fixture = () => ({
  // generatedFrom is an ARRAY of source documents, as the real registry carries it. It was a bare
  // string here until the schema was wired into validate() on 2026-08-26 and said so: a fixture
  // whose shape diverges from the registry proves things about a document the repo does not hold.
  version: 7, generatedFrom: ['fixture'], verifiedAgainst: 'fixture', note: 'fixture',
  families: [
    { roman: 'I', key: 'false_clean', prefix: 'C', name: 'False clean', proposition: 'nothing is wrong' , test: 'A fixture membership test, long enough to satisfy the schema minimum length for a family test.'},
    { roman: 'IX', key: 'false_control', prefix: 'K', name: 'False control', proposition: 'the deciding layer decided it' , test: 'A fixture membership test, long enough to satisfy the schema minimum length for a family test.'},
  ],
  classes: [
    cls('C1', 'false_clean.one', 4, 1, [{ loop: 'monitor', uca: 'none', cause: 'feedback-missing' }, { loop: 'attention', uca: 'unsafe', cause: 'actuator-corrupt' }]),
    cls('C2', 'false_clean.two', 2, 3, [{ loop: 'monitor', uca: 'not-provided', cause: 'feedback-missing' }]),
    cls('K1', 'false_control.one', 1, 4, [{ loop: 'operator', uca: 'out-of-order', cause: 'controller-algorithm' }, { loop: 'attention', uca: 'too-late', cause: 'actuator-delayed' }]),
    cls('K2', 'false_control.two', 0, 2, [{ loop: 'oversight', uca: 'too-late', cause: 'actuator-missing' }]),
  ],
  scales: { closure: '0..4', gain: '0..4' },
  remediations: [], attributionPlan: [],
  scoreProvenance: 'fixture', scaleBounds: { closureMin: 0, closureMax: 4, gainMin: 0, gainMax: 4, fullyClosed: 4 },
  stpaVocabulary: structuredClone(VOCAB), stpaProvenance: { ...PROVENANCE },
  rcaVocabulary: structuredClone(RCA_VOCAB), rcaProvenance: { ...PROVENANCE },
});

const NARROW = "SELECT DISTINCT class_id FROM taxonomy_stpa WHERE loop != 'attention' AND uca IN ('not-provided','too-late') ORDER BY class_id";
const WIDE = "SELECT DISTINCT class_id FROM taxonomy_stpa WHERE uca IN ('not-provided','too-late') ORDER BY class_id";

const fresh = () => new DatabaseSync(':memory:');
const ids = (rows) => rows.map((r) => r.class_id);
const tmp = () => mkdtempSync(join(tmpdir(), 'cw-stpa-'));
const writeReg = (dir, doc) => { const p = join(dir, 'registry.json'); writeFileSync(p, JSON.stringify(doc)); return p; };
// The page is redacted on write and the render refuses without a map. The live map is private and
// absent from a clone, so the page test hands the render a synthetic one.
const writeMap = (dir) => {
  const p = join(dir, 'publish-redactions.json');
  writeFileSync(p, JSON.stringify({ note: 'fixture', map: { 'acme-fixture-ltd': 'client-fixture' } }));
  return p;
};

function run(cli, args, env = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('the fixture validates, builds, and `none` is a stored value', () => {
  const doc = fixture();
  assert.deepEqual(validate(doc), []);
  const db = fresh();
  build(db, doc, 'fx');
  const c1 = db.prepare('SELECT rank, loop, uca, cause FROM taxonomy_stpa WHERE class_id = ? ORDER BY rank').all('C1');
  assert.deepEqual(c1.map((r) => ({ ...r })), [
    { rank: 1, loop: 'monitor', uca: 'none', cause: 'feedback-missing' },
    { rank: 2, loop: 'attention', uca: 'unsafe', cause: 'actuator-corrupt' },
  ]);
  assert.equal(db.prepare("SELECT value FROM taxonomy_meta WHERE key = 'stpaEntries'").get().value, '6');
  assert.equal(JSON.parse(db.prepare("SELECT value FROM taxonomy_meta WHERE key = 'stpaProvenance'").get().value).date, '2026-08-23');
});

test('the vocabulary round-trips into the CHECK constraints — every value, generated not restated', () => {
  const doc = fixture();
  const db = fresh();
  build(db, doc, 'fx');
  const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'taxonomy_stpa'").get().sql;
  for (const [m, col] of [['loops', 'loop'], ['uca', 'uca'], ['cause', 'cause']]) {
    const list = /CHECK \((\w+) IN \(([^)]*)\)\)/g;
    let found = null;
    for (const mm of ddl.matchAll(list)) if (mm[1] === col) found = mm[2];
    assert.ok(found, `no CHECK on ${col}`);
    const inDdl = found.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    assert.deepEqual(inDdl.sort(), Object.keys(doc.stpaVocabulary[m]).sort(), `${col} CHECK must carry exactly the vocabulary`);
  }
  // A registry declaring a ninth UCA must produce a schema that accepts it.
  const wider = fixture();
  wider.stpaVocabulary.uca['too-slow'] = { test: 'fixture' };
  wider.classes[1].stpa[0].uca = 'too-slow';
  const db2 = fresh();
  build(db2, wider, 'wide');
  assert.equal(db2.prepare("SELECT uca FROM taxonomy_stpa WHERE class_id = 'C2'").get().uca, 'too-slow');
});

test('an out-of-vocabulary uca is refused by the CHECK, and named by validate()', () => {
  const doc = fixture();
  const db = fresh();
  build(db, doc, 'fx');
  assert.throws(
    () => db.prepare('INSERT INTO taxonomy_stpa (class_id, rank, loop, uca, cause) VALUES (?,?,?,?,?)').run('C2', 9, 'monitor', 'too-slow', 'feedback-missing'),
    /CHECK/i);
  const bad = fixture();
  bad.classes[1].stpa[0].uca = 'too-slow';
  assert.throws(() => build(fresh(), bad, 'bad'), /CHECK/i);
  assert.match(validate(bad).join('\n'), /C2: stpa\[0\]\.uca "too-slow" is not in stpaVocabulary\.uca/);
  // The other two columns are gated the same way.
  const badLoop = fixture(); badLoop.classes[1].stpa[0].loop = 'weather';
  assert.throws(() => build(fresh(), badLoop, 'x'), /CHECK/i);
  const badCause = fixture(); badCause.classes[1].stpa[0].cause = 'gremlins';
  assert.throws(() => build(fresh(), badCause, 'x'), /CHECK/i);
});

test('a class with no stpa fails validate() AND --build — absent and empty alike', () => {
  for (const strip of [(c) => { delete c.stpa; }, (c) => { c.stpa = []; }]) {
    const doc = fixture();
    strip(doc.classes[1]);
    assert.match(validate(doc).join('\n'), /^C2: no stpa entries — uca "none" is a value, not an omission$/m);
    assert.throws(() => build(fresh(), doc, 'x'), /^Error: C2: no stpa entries — every class must carry a non-empty stpa array \(uca "none" is a value, not an omission\)$/);
    const dir = tmp();
    const r = run(DB_CLI, ['--build'], { CW_DB: join(dir, 'x.db'), CW_TAXONOMY_JSON: writeReg(dir, doc) });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /^build refused: C2: no stpa entries/m);
    assert.equal(r.stdout, '', 'a refused build prints no "built" line');
  }
});

test('a registry with no stpaVocabulary is refused by build and validate, naming the field', () => {
  const { stpaVocabulary, ...doc } = fixture();
  assert.throws(() => build(fresh(), doc, 'x'), (e) => e.message === MSG_NO_VOCABULARY);
  assert.equal(MSG_NO_VOCABULARY, 'registry declares no stpaVocabulary — refusing to invent the loop/uca/cause vocabulary the taxonomy_stpa CHECK constraints enforce');
  assert.match(validate(doc).join('\n'), /^stpaVocabulary is missing/m);
  // An empty map is the same absence with a different shape.
  const hollow = fixture(); hollow.stpaVocabulary.uca = {};
  assert.throws(() => build(fresh(), hollow, 'x'), /stpaVocabulary\.uca is missing or empty/);
  assert.match(validate(hollow).join('\n'), /stpaVocabulary\.uca is missing or empty/);
});

test('the narrow and wide queries return the expected ids, in-process and through --sql', () => {
  const doc = fixture();
  const db = fresh();
  build(db, doc, 'fx');
  assert.deepEqual(ids(db.prepare(NARROW).all()), ['C2', 'K2']);
  assert.deepEqual(ids(db.prepare(WIDE).all()), ['C2', 'K1', 'K2']);
  // Over open classes only, all ranks: same answer here because C1 (closed) matches neither.
  assert.deepEqual(ids(db.prepare("SELECT DISTINCT class_id FROM taxonomy_open_stpa WHERE uca IN ('not-provided','too-late') ORDER BY class_id").all()), ['C2', 'K1', 'K2']);

  const dir = tmp();
  const env = { CW_DB: join(dir, 'x.db'), CW_TAXONOMY_JSON: writeReg(dir, doc) };
  assert.equal(run(DB_CLI, ['--build'], env).code, 0);
  const narrow = run(DB_CLI, ['--sql', NARROW], env);
  assert.equal(narrow.code, 0);
  assert.deepEqual(ids(JSON.parse(narrow.stdout)), ['C2', 'K2']);
  assert.deepEqual(ids(JSON.parse(run(DB_CLI, ['--sql', WIDE], env).stdout)), ['C2', 'K1', 'K2']);
  assert.equal(narrow.stderr, '', 'a freshly built store is not stale');
});

test('taxonomy_open exposes the PRIMARY entry, and --open prints it', () => {
  const doc = fixture();
  const db = fresh();
  build(db, doc, 'fx');
  const open = Object.fromEntries(db.prepare('SELECT id, loop, uca, cause FROM taxonomy_open').all().map((r) => [r.id, r]));
  assert.equal(open.C1, undefined, 'closed classes are not residual risk');
  assert.deepEqual({ ...open.C2 }, { id: 'C2', loop: 'monitor', uca: 'not-provided', cause: 'feedback-missing' });
  assert.deepEqual({ ...open.K1 }, { id: 'K1', loop: 'operator', uca: 'out-of-order', cause: 'controller-algorithm' },
    'the attention-loop entry is rank 2 and must not displace the primary');
  const dir = tmp();
  const env = { CW_DB: join(dir, 'x.db'), CW_TAXONOMY_JSON: writeReg(dir, doc) };
  run(DB_CLI, ['--build'], env);
  assert.match(run(DB_CLI, ['--open'], env).stdout, /K2 .* oversight:too-late\/actuator-missing /);
});

test('a duplicate loop on one class is refused by validate() and by the store', () => {
  const doc = fixture();
  doc.classes[1].stpa.push({ loop: 'monitor', uca: 'too-late', cause: 'actuator-delayed' });
  assert.match(validate(doc).join('\n'), /C2: loop "monitor" appears twice/);
  assert.throws(() => build(fresh(), doc, 'x'), /UNIQUE/i);
});

test('validate() rejects unknown entry keys, non-object entries, and vocabulary values without a test', () => {
  const extra = fixture();
  extra.classes[0].stpa[0].note = 'why';
  assert.match(validate(extra).join('\n'), /C1: stpa\[0\] carries unknown key "note"/);

  const scalar = fixture();
  scalar.classes[0].stpa[1] = 'attention';
  assert.match(validate(scalar).join('\n'), /C1: stpa\[1\] is not an object/);

  const untested = fixture();
  untested.stpaVocabulary.cause['feedback-missing'] = { test: '   ' };
  assert.match(validate(untested).join('\n'), /stpaVocabulary\.cause\.feedback-missing: no test/);

  const noController = fixture();
  delete noController.stpaVocabulary.loops.monitor.controller;
  assert.match(validate(noController).join('\n'), /stpaVocabulary\.loops\.monitor: missing controller/);

  const noProv = fixture();
  delete noProv.stpaProvenance;
  assert.match(validate(noProv).join('\n'), /stpaProvenance is missing or incomplete/);
  const badDate = fixture();
  badDate.stpaProvenance.date = 'yesterday';
  assert.match(validate(badDate).join('\n'), /stpaProvenance\.date "yesterday" is not YYYY-MM-DD/);
});

test('a rebuild on an existing store re-derives the CHECK from the current vocabulary', () => {
  const dir = tmp();
  const db = new DatabaseSync(join(dir, 'x.db'));
  build(db, fixture(), 'v1');
  const narrower = fixture();
  delete narrower.stpaVocabulary.uca['out-of-order'];
  narrower.classes[2].stpa[0].uca = 'unsafe';
  build(db, narrower, 'v2');
  // Under IF NOT EXISTS alone the v1 CHECK would survive and still admit the retired value.
  assert.throws(
    () => db.prepare('INSERT INTO taxonomy_stpa (class_id, rank, loop, uca, cause) VALUES (?,?,?,?,?)').run('K2', 5, 'agent', 'out-of-order', 'actuator-missing'),
    /CHECK/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM taxonomy_stpa').get().n, 6);
});

test('render --check passes on the fixture and the page carries the tags, self-contained', () => {
  const dir = tmp();
  const reg = writeReg(dir, fixture());
  const check = run(RENDER_CLI, ['--check'], { CW_TAXONOMY_JSON: reg });
  assert.equal(check.code, 0, check.stderr);
  assert.match(check.stdout, /primary uca not-provided:1 unsafe:0 too-early:0 too-late:1 out-of-order:1 stopped-too-soon:0 applied-too-long:0 none:1/);

  const out = join(dir, 'page.html');
  const r = run(RENDER_CLI, ['--json', reg, '--out', out], { CW_PUBLISH_REDACTIONS: writeMap(dir) });
  assert.equal(r.code, 0, r.stderr);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /<span class="tag uca" title="A required action was never issued\.">not-provided<\/span>/);
  assert.match(html, /<span class="tag cause" title="[^"]*">feedback-missing<\/span>/);
  // The loop carries its 1-based vocabulary position — attention is the sixth loop in the fixture —
  // so a row can be cited as "loop 6" and the legend resolves it.
  assert.match(html, /<span class="stpa more"><span class="loop" title="[^"]*">6 attention<\/span><span title="[^"]*">unsafe<\/span> \/ <span title="[^"]*">actuator-corrupt<\/span>/);
  assert.match(html, /<b>6 attention<\/b> \(/, 'legend numbers the loops in vocabulary order');
  assert.match(html, /<span class="tag CTRL" title="[^"]*">CONTROLLER<\/span>/, 'layer prints its long name; the enum stays CTRL');
  assert.doesNotMatch(html, />CTRL<\/span>|>IMPL<\/span>/, 'no short layer names survive on the page');
  assert.match(html, /<span class="tag uca" title="[^"]*">none<\/span>/, 'none renders as a value, not as an empty cell');
  assert.match(html, /STPA is one rater\.<\/b> one reader, 2026-08-23/);
  assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)="https?:/i, 'no CDN, file:// safe');
  assert.doesNotMatch(html, /@import/);

  const missing = fixture(); delete missing.classes[3].stpa;
  const refused = run(RENDER_CLI, ['--check'], { CW_TAXONOMY_JSON: writeReg(dir, missing) });
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /registry: K2: no stpa entries/);
});

test('the real registry: --build either refuses naming the missing field, or classifies every class', (tc) => {
  const raw = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const dir = tmp();
  const r = run(DB_CLI, ['--build'], { CW_DB: join(dir, 'x.db'), CW_TAXONOMY_JSON: REGISTRY });
  if (!raw.stpaVocabulary) {
    tc.diagnostic('real registry carries no stpaVocabulary yet — asserting the refusal, not the projection');
    assert.equal(r.code, 1);
    assert.equal(r.stderr.trim(), `build refused: ${MSG_NO_VOCABULARY}`);
    assert.equal(r.stdout, '');
    return;
  }
  tc.diagnostic('real registry carries stpaVocabulary — asserting every class is classified');
  assert.equal(r.code, 0, r.stderr);
  const db = new DatabaseSync(join(dir, 'x.db'), { readOnly: true });
  const unclassified = db.prepare('SELECT c.id FROM taxonomy_class c LEFT JOIN taxonomy_stpa s ON s.class_id = c.id AND s.rank = 1 WHERE s.class_id IS NULL').all();
  assert.deepEqual(unclassified, []);
  assert.deepEqual(validate(raw), []);
});

// taxonomy-db.test.mjs — the projection must refuse to hold a registry it cannot represent.
// The database exists so a program can ask "which open classes does this touch" without
// re-implementing the filter; a store that accepts a malformed class would answer that question
// confidently and wrongly, which is the C10 this whole catalogue is about with an index on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, SCHEMA, MSG_NO_VOCABULARY, schemaDrift, schemaFor, openFresh } from '../taxonomy-db.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'taxonomy-db.mjs');
const REGISTRY = resolve(HERE, '..', '..', 'monitor', 'failure-taxonomy.json');
const raw = JSON.parse(readFileSync(REGISTRY, 'utf8'));

// The stpa axis is a build-time gate (taxonomy-stpa.test.mjs owns it). Until the registry carries
// it, every test below would fail on that gate and say nothing about what it actually tests, so a
// minimal vocabulary is GRAFTED on when — and only when — the real registry has none. The graft is
// the smallest valid shape, not a copy of the proposal, so nothing here can pass for real data.
const STPA_READY = !!(raw.stpaVocabulary && typeof raw.stpaVocabulary === 'object');
const graft = (d) => ({
  ...d,
  stpaVocabulary: {
    loops: { monitor: { controller: 'graft', controls: 'graft', test: 'graft' } },
    uca: { none: { test: 'graft' } },
    cause: { 'feedback-missing': { test: 'graft' } },
  },
  stpaProvenance: { rater: 'graft', date: '1970-01-01', method: 'graft', caveat: 'test graft, not a rating' },
  classes: d.classes.map((c) => ({ ...c, stpa: [{ loop: 'monitor', uca: 'none', cause: 'feedback-missing' }] })),
});
const doc = STPA_READY ? raw : graft(raw);

const fresh = () => new DatabaseSync(':memory:');
const tmpReg = (d = doc) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-taxdb-'));
  const reg = join(dir, 'registry.json');
  writeFileSync(reg, JSON.stringify(d));
  return { dir, reg, db: join(dir, 'x.db') };
};

// stderr is captured on BOTH branches. Capturing it only on the failure path made every warning
// invisible to a test whose command exits 0 — so an assertion that a warning was printed could
// never pass, and its absence would have read as "the code does not warn".
function run(args, env = {}) {
  const opts = { encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    const r = spawnSync(process.execPath, [CLI, ...args], opts);
    return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

test('every class in the registry lands, with its family joined', () => {
  const db = fresh();
  const n = build(db, doc, 'deadbeef');
  assert.equal(n.classes, doc.classes.length);
  const joined = db.prepare('SELECT COUNT(*) AS n FROM taxonomy_class c JOIN taxonomy_family f ON f.prefix = c.prefix').get();
  assert.equal(joined.n, doc.classes.length, 'no class may be orphaned from its family');
});

// A class that is malformed in the way under test, and valid in every other way — the stpa gate
// runs before the insert, so a fixture class without stpa would be refused for the wrong reason.
const stray = (over = {}) => ({ id: 'Z1', name: 'x', machine: 'zz.x', layer: 'CTRL', description: 'd', analogy: 'a', example: 'e',
  predicate: 'A stray fixture predicate, long enough to clear the schema minimum length.',
  closure: 0, gain: 0, stpa: [{ ...doc.classes[0].stpa[0] }], ...over });

test('a class naming an undeclared family is refused, not stored', () => {
  const db = fresh();
  const bad = { ...doc, classes: [...doc.classes, stray()] };
  assert.throws(() => build(db, bad, 'x'), /FOREIGN KEY/i);
});

test('closure and gain outside 0-4 are refused by the store itself', () => {
  const db = fresh();
  db.exec(SCHEMA);
  db.exec("INSERT INTO taxonomy_family VALUES ('C','I','false_clean','False clean','nothing is wrong')");
  const ins = db.prepare(`INSERT INTO taxonomy_class VALUES ('C1','C',1,'n','m','CTRL','d','p','a','e',?,?,'b')`);
  assert.throws(() => ins.run(5, 0), /CHECK/i);
  assert.throws(() => ins.run(0, -1), /CHECK/i);
});

test('a duplicate machine name cannot be stored twice', () => {
  const db = fresh();
  build(db, doc, 'x');
  const first = doc.classes[0];
  assert.throws(
    () => db.prepare(`INSERT INTO taxonomy_class VALUES ('ZZ9','C',99,'n',?,'CTRL','d','p','a','e',0,0,'b')`).run(first.machine),
    /UNIQUE/i);
});

test('rebuilding is idempotent — the same registry produces the same rows', () => {
  const db = fresh();
  build(db, doc, 'x');
  const before = db.prepare('SELECT id, closure, gain FROM taxonomy_class ORDER BY id').all();
  build(db, doc, 'x');
  const after = db.prepare('SELECT id, closure, gain FROM taxonomy_class ORDER BY id').all();
  assert.deepEqual(after, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM taxonomy_class').get().n, doc.classes.length);
});

test('taxonomy_open ranks by gain first and excludes fully closed classes', () => {
  const db = fresh();
  build(db, doc, 'x');
  const rows = db.prepare('SELECT * FROM taxonomy_open').all();
  assert.ok(rows.every((r) => r.closure < 4), 'a closed class is not residual risk');
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].priority >= rows[i].priority, 'priority must be monotonic');
  assert.equal(rows[0].gain, 4);
});

test('every remediation and attribution row references classes that exist', () => {
  const db = fresh();
  build(db, doc, 'x');
  const orphanR = db.prepare('SELECT COUNT(*) AS n FROM taxonomy_remediation_class rc LEFT JOIN taxonomy_class c ON c.id = rc.class_id WHERE c.id IS NULL').get();
  const orphanA = db.prepare('SELECT COUNT(*) AS n FROM taxonomy_attribution_class ac LEFT JOIN taxonomy_class c ON c.id = ac.class_id WHERE c.id IS NULL').get();
  assert.equal(orphanR.n, 0);
  assert.equal(orphanA.n, 0);
});

test('--verify fails when the registry moves under a built database', () => {
  const { db, reg } = tmpReg();
  assert.equal(run(['--build'], { CW_DB: db, CW_TAXONOMY_JSON: reg }).code, 0);
  assert.equal(run(['--verify'], { CW_DB: db, CW_TAXONOMY_JSON: reg }).code, 0);

  writeFileSync(reg, JSON.stringify({ ...doc, version: 99 }));
  const drifted = run(['--verify'], { CW_DB: db, CW_TAXONOMY_JSON: reg });
  assert.equal(drifted.code, 1, 'a database that disagrees with its source must say so');
  assert.match(drifted.stderr, /DRIFT/);
});

test('--sql refuses anything that is not a read', () => {
  const { db, reg } = tmpReg();
  assert.equal(run(['--build'], { CW_DB: db, CW_TAXONOMY_JSON: reg }).code, 0);
  assert.equal(run(['--sql', 'DELETE FROM taxonomy_class'], { CW_DB: db, CW_TAXONOMY_JSON: reg }).code, 2);
  assert.equal(run(['--sql', 'SELECT COUNT(*) AS n FROM taxonomy_class'], { CW_DB: db, CW_TAXONOMY_JSON: reg }).code, 0);
});

test('a failed build rolls back — the store never holds a prefix of the taxonomy', () => {
  const db = fresh();
  build(db, doc, 'good');
  const bad = { ...doc, classes: [...doc.classes.slice(0, 10), stray()] };
  assert.throws(() => build(db, bad, 'bad'), /FOREIGN KEY/i);
  // Measured before the transaction landed: 10 classes, 0 meta rows, and --open answered over them.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM taxonomy_class').get().n, doc.classes.length,
    'a rolled-back build leaves the previous taxonomy intact, not a prefix of the new one');
  assert.equal(db.prepare("SELECT value FROM taxonomy_meta WHERE key = 'sourceSha256'").get().value, 'good');
  // The stpa table is dropped and recreated inside the same transaction, so it rolls back with the rest.
  assert.equal(db.prepare('SELECT COUNT(DISTINCT class_id) AS n FROM taxonomy_stpa').get().n, doc.classes.length,
    'a rolled-back build leaves every class classified, not an empty stpa table beside the old classes');
});

test('a read after the registry moves rebuilds first and answers from the new edition', () => {
  const { db, reg } = tmpReg();
  const env = { CW_DB: db, CW_TAXONOMY_JSON: reg };
  assert.equal(run(['--build'], env).code, 0);
  const id = doc.classes[0].id;
  const q = `SELECT name FROM taxonomy_class WHERE id = '${id}'`;
  assert.equal(JSON.parse(run(['--sql', q], env).stdout)[0].name, doc.classes[0].name);

  // Measured before this: a STALE warning on stderr, then the previous edition's row on stdout.
  writeFileSync(reg, JSON.stringify({ ...doc, classes: doc.classes.map((c, i) => (i ? c : { ...c, name: 'renamed in fixture' })) }));
  const moved = run(['--sql', q], env);
  assert.equal(moved.code, 0);
  assert.equal(JSON.parse(moved.stdout)[0].name, 'renamed in fixture', 'the answer must come from the registry on disk');
  assert.match(moved.stderr, /rebuilt the store/);
  assert.equal(run(['--verify'], env).code, 0, 'the read left the store in sync');

  // In sync: no rebuild, no notice.
  assert.equal(run(['--open'], env).stderr, '');
});

test('a read with no store yet builds one rather than failing on a missing file', () => {
  const { db, reg } = tmpReg();
  const r = run(['--sql', 'SELECT COUNT(*) AS n FROM taxonomy_class'], { CW_DB: db, CW_TAXONOMY_JSON: reg });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout)[0].n, doc.classes.length);
});

test('a registry that cannot be read, parsed or built is a refusal, never an answer from the old build', () => {
  const { dir, db, reg } = tmpReg();
  const env = { CW_DB: db, CW_TAXONOMY_JSON: reg };
  assert.equal(run(['--build'], env).code, 0);
  const q = ['--sql', 'SELECT COUNT(*) AS n FROM taxonomy_class'];
  const refused = (r, why) => {
    assert.equal(r.code, 1, why);
    assert.equal(r.stdout, '', `${why}: nothing may be answered`);
    assert.match(r.stderr, /refused: the store cannot be confirmed current/);
  };

  writeFileSync(reg, '{ not json');
  refused(run(q, env), 'unparseable registry');

  const { scaleBounds, ...noBounds } = doc;
  writeFileSync(reg, JSON.stringify(noBounds));
  refused(run(['--open'], env), 'registry the build refuses');
  refused(run(['--find', 'x'], env), 'registry the build refuses');

  refused(run(q, { ...env, CW_TAXONOMY_JSON: join(dir, 'never-written.json') }), 'absent registry');

  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    writeFileSync(reg, JSON.stringify(doc));
    chmodSync(reg, 0o000);
    const blind = run(q, env);
    chmodSync(reg, 0o644);
    refused(blind, 'unreadable registry');
  }

  // The refusals left the last good build in place; a readable registry is answered again.
  writeFileSync(reg, JSON.stringify(doc));
  assert.equal(JSON.parse(run(q, env).stdout)[0].n, doc.classes.length);
});

test('openFresh answers inside the snapshot it checked, and refuses a registry that never settles', () => {
  const { reg, db } = tmpReg();
  const src = () => {
    const bytes = readFileSync(reg, 'utf8');
    return { doc: JSON.parse(bytes), hash: createHash('sha256').update(bytes).digest('hex') };
  };
  const first = openFresh({ file: db, source: src });
  assert.equal(first.rebuilt, true);
  assert.equal(first.db.prepare("SELECT value FROM taxonomy_meta WHERE key = 'sourceSha256'").get().value, first.hash);
  first.db.close();
  const again = openFresh({ file: db, source: src });
  assert.equal(again.rebuilt, false);
  again.db.close();

  let n = 0;
  const churning = () => ({ doc, hash: `edition-${n++}` });
  assert.throws(() => openFresh({ file: db, source: churning, attempts: 3 }), /changed 3 times/);
});

test('the CHECK constraints are generated from the registry, not restated in the schema', () => {
  const db = fresh();
  // A registry declaring a wider scale must produce a schema that accepts it. If the bound were
  // still hardcoded, this row would be refused by a constraint enforcing last week's rule.
  const wide = {
    ...doc,
    scaleBounds: { closureMin: 0, closureMax: 6, gainMin: 0, gainMax: 6, fullyClosed: 6 },
    classes: doc.classes.map((c) => (c.id === 'A2' ? { ...c, closure: 6 } : c)),
  };
  build(db, wide, 'wide');
  assert.equal(db.prepare("SELECT closure FROM taxonomy_class WHERE id='A2'").get().closure, 6);
});

test('a registry with no scaleBounds is refused rather than given an invented range', () => {
  const db = fresh();
  const { scaleBounds, ...noBounds } = doc;
  assert.throws(() => build(db, noBounds, 'x'), /scaleBounds/);
});

test('the real registry on disk: without stpa the build is refused by name; with it, it builds', (t) => {
  // Branching on the registry's state is deliberate and is said out loud: the graft above keeps the
  // other tests meaningful, and this one is where the ungrafted file is judged as it is.
  const db = fresh();
  if (!STPA_READY) {
    t.diagnostic(`real registry has no stpaVocabulary — the other tests ran on a graft; build refuses with: ${MSG_NO_VOCABULARY}`);
    assert.throws(() => build(db, raw, 'real'), (e) => e.message === MSG_NO_VOCABULARY);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'taxonomy_class'").get().n, 0,
      'a refused build creates nothing');
    return;
  }
  t.diagnostic('real registry carries stpaVocabulary — the other tests ran on the real file');
  assert.equal(build(db, raw, 'real').classes, raw.classes.length);
});

test('a registry that grows a column rebuilds the store rather than freezing it', () => {
  const db = fresh();
  // Build once with a class shape that lacks `predicate`, the way the store existed before the
  // column was added. CREATE TABLE IF NOT EXISTS would keep that shape forever: measured on the
  // live file, every build refused with "no column named predicate" while the registry moved from
  // 97 classes to 179, so the projection could never catch up and said so loudly each time.
  const oldShape = SCHEMA.replace(/\n  predicate[^\n]*\n/, '\n');
  assert.notEqual(oldShape, SCHEMA, 'the fixture must actually drop the column, or this proves nothing');
  db.exec(oldShape);
  assert.equal(db.prepare('PRAGMA table_info(taxonomy_class)').all().some((c) => c.name === 'predicate'), false);

  build(db, doc, 'after');
  assert.equal(db.prepare('PRAGMA table_info(taxonomy_class)').all().some((c) => c.name === 'predicate'), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM taxonomy_class').get().n, doc.classes.length);
});

test('schemaDrift is false for a store already at the current shape', () => {
  const db = fresh();
  build(db, doc, 'x');
  // Compare against the schema build() ACTUALLY applies, not the exported default: SCHEMA carries
  // no stpa vocabulary, so probing with it reports drift that build() would never produce. The
  // first version of this test asserted against the wrong constant and failed for that reason.
  const applied = schemaFor(doc.scaleBounds, doc.stpaVocabulary);
  assert.equal(schemaDrift(db, applied), false, 'a matching store must not be recreated on every build');
});

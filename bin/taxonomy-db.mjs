#!/usr/bin/env node
/**
 * taxonomy-db.mjs — load monitor/failure-taxonomy.json into commitwork's SQLite store.
 *
 * WHY A DATABASE AND NOT THE JSON. The registry closed M7 for a reader (counts are computed, not
 * asserted). It does not close it for a PROGRAM: every consumer that wants "which open classes does
 * this gate touch" re-implements a filter over a 96-element array, and the first one to get it
 * subtly wrong produces a confident wrong number with no way to notice. A relation with foreign
 * keys refuses the malformed question instead of answering it.
 *
 * ZERO DEPENDENCIES. node:sqlite is built in from Node 22; this repo runs 26. No driver, no build
 * step, and `npm ls` stays empty, which is a property several CRA controls depend on.
 *
 * THE JSON REMAINS THE SOURCE OF TRUTH. This is a projection: --build drops and rebuilds every
 * taxonomy table from the file, records the file's sha256 in taxonomy_meta, and is idempotent.
 * A database that could drift from the registry silently would be a C10 with an index on it, so
 * --open, --find and --sql rebuild first whenever the stored hash differs, and refuse (exit 1)
 * rather than answer when the registry cannot be read or built.
 *
 * Usage:
 *   taxonomy-db.mjs --build            rebuild the taxonomy tables from the registry
 *   taxonomy-db.mjs --verify           compare the stored source hash against the registry on disk
 *   taxonomy-db.mjs --open             list classes not fully closed, worst first
 *   taxonomy-db.mjs --sql "<query>"    run a read-only query (SELECT/WITH only)
 * Env: CW_DB (default monitor/commitwork.db), CW_TAXONOMY_JSON — both read at call time.
 *
 * STPA. Each class carries stpa: [{ loop, uca, cause }, …], first entry primary, projected into
 * taxonomy_stpa (one row per entry, rank 1-based). The narrow reading of "which classes are a
 * response not provided or not in time" is
 *   SELECT DISTINCT class_id FROM taxonomy_stpa WHERE loop != 'attention' AND uca IN ('not-provided','too-late')
 * and the wide reading drops the loop filter. taxonomy_open_stpa is the same over open classes.
 */
import { isMainModule } from '../lib/is-main.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = () => process.env.CW_DB || resolve(REPO, 'monitor', 'commitwork.db');
const jsonPath = () => process.env.CW_TAXONOMY_JSON || resolve(REPO, 'monitor', 'failure-taxonomy.json');
const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
};

// SQL literal for a vocabulary key. The DDL is generated from data, so a key is quoted like a
// value, never pasted: a vocabulary entry named O'Brien must become a constraint, not a statement.
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const inList = (map) => Object.keys(map).map(lit).join(',');

/**
 * The stpa table's three CHECKs are GENERATED from stpaVocabulary exactly as the closure CHECK is
 * generated from scaleBounds: one enum, declared once in the registry, never restated here. The
 * table is a leaf (nothing references it), so build() drops and recreates it on every run — an
 * IF NOT EXISTS table would keep last edition's CHECK and accept a value the vocabulary has since
 * retired. rank is 1-based and rank 1 is the primary entry (the class's own loop), matching
 * taxonomy_remediation.rank. UNIQUE (class_id, loop): one judgement per loop per class.
 */
export const stpaSchemaFor = (v) => `
CREATE TABLE IF NOT EXISTS taxonomy_stpa (
  class_id TEXT NOT NULL REFERENCES taxonomy_class(id),
  rank     INTEGER NOT NULL CHECK (rank >= 1),
  loop     TEXT NOT NULL CHECK (loop IN (${inList(v.loops)})),
  uca      TEXT NOT NULL CHECK (uca IN (${inList(v.uca)})),
  cause    TEXT NOT NULL CHECK (cause IN (${inList(v.cause)})),
  PRIMARY KEY (class_id, rank),
  UNIQUE (class_id, loop)
);

CREATE INDEX IF NOT EXISTS idx_stpa_uca ON taxonomy_stpa(uca, loop);

-- Every entry of every open class, so "which open classes are a response not provided or not in
-- time" is one query with or without the loop filter. Defined over taxonomy_open so the priority
-- formula exists once.
CREATE VIEW IF NOT EXISTS taxonomy_search AS
  -- Every field a mechanism can hide in, in ONE searchable column.
  -- Prior art is checked here, and a description-only query reports a gap the registry does not
  -- have. P5's DEFINITION says "the instrument deciding whose a change is is itself wrong" and
  -- names no clock, while its EXAMPLE is a local-offset-versus-UTC comparison -- so a search for
  -- timezone wording missed it on 2026-09-06 and a duplicate class was nearly minted at closure 0
  -- beside P5's closure 4, which would have made the registry call one mechanism both fully closed
  -- and completely open. The text column is lowercased so callers LIKE without minding case.
  SELECT id, prefix, ordinal, name, layer, closure, gain,
         lower(coalesce(name,'') || ' ' || coalesce(description,'') || ' ' ||
               coalesce(predicate,'') || ' ' || coalesce(analogy,'') || ' ' ||
               coalesce(example,'') || ' ' || coalesce(score_basis,'')) AS text,
         description, predicate, example, score_basis
    FROM taxonomy_class;

CREATE VIEW IF NOT EXISTS taxonomy_open_stpa AS
  SELECT o.id AS class_id, o.family, o.name, o.layer, o.closure, o.gain, o.priority,
         s.rank, s.loop, s.uca, s.cause
    FROM taxonomy_open o JOIN taxonomy_stpa s ON s.class_id = o.id
   ORDER BY o.priority DESC, o.id, s.rank;
`;

// The CHECK constraints are GENERATED from the registry's declared bounds rather than restating
// them: a schema carrying its own copy of the rule enforces last week's rule with full confidence.
// With a vocabulary the schema also carries taxonomy_stpa; without one it cannot, and says nothing.
export const schemaFor = (b, v) => `
CREATE TABLE IF NOT EXISTS taxonomy_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS taxonomy_family (
  prefix      TEXT PRIMARY KEY,
  roman       TEXT NOT NULL,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  proposition TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taxonomy_class (
  id          TEXT PRIMARY KEY,
  prefix      TEXT NOT NULL REFERENCES taxonomy_family(prefix),
  ordinal     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  machine     TEXT NOT NULL UNIQUE,
  layer       TEXT NOT NULL CHECK (layer IN ('CTRL','IMPL','BOTH')),
  description TEXT NOT NULL,
  -- The executable question that decides membership. NOT NULL because a class whose predicate is
  -- optional cannot answer "does an existing class already accept these inputs and return this
  -- verdict" — which is the check that catches a duplicate its filer never saw.
  predicate   TEXT NOT NULL,
  analogy     TEXT NOT NULL,
  example     TEXT NOT NULL,
  closure     INTEGER NOT NULL CHECK (closure BETWEEN ${b.closureMin} AND ${b.closureMax}),
  gain        INTEGER NOT NULL CHECK (gain BETWEEN ${b.gainMin} AND ${b.gainMax}),
  score_basis TEXT NOT NULL,
  UNIQUE (prefix, ordinal)
);

CREATE TABLE IF NOT EXISTS taxonomy_remediation (
  rank   INTEGER PRIMARY KEY,
  title  TEXT NOT NULL,
  action TEXT NOT NULL,
  note   TEXT NOT NULL,
  effort TEXT NOT NULL,
  gain   INTEGER NOT NULL CHECK (gain BETWEEN ${b.gainMin} AND ${b.gainMax}),
  layer  TEXT NOT NULL
);

-- The join table is the point: "which remediations touch P-family" is a query, not a grep.
CREATE TABLE IF NOT EXISTS taxonomy_remediation_class (
  rank     INTEGER NOT NULL REFERENCES taxonomy_remediation(rank),
  class_id TEXT NOT NULL REFERENCES taxonomy_class(id),
  relation TEXT NOT NULL CHECK (relation IN ('closes','raises')),
  PRIMARY KEY (rank, class_id, relation)
);

CREATE TABLE IF NOT EXISTS taxonomy_attribution (
  area      TEXT PRIMARY KEY,
  defect    TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  change    TEXT NOT NULL,
  effort    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taxonomy_attribution_class (
  area     TEXT NOT NULL REFERENCES taxonomy_attribution(area),
  class_id TEXT NOT NULL REFERENCES taxonomy_class(id),
  PRIMARY KEY (area, class_id)
);

CREATE INDEX IF NOT EXISTS idx_class_gain ON taxonomy_class(gain DESC, closure ASC);
CREATE INDEX IF NOT EXISTS idx_class_layer ON taxonomy_class(layer);

-- THE BOUND IS THE REGISTRY'S, NEVER THIS FILE'S. These three read a literal 4 while the CHECK
-- constraint fourteen lines above already took b.closureMax off the same bounds object: one bound,
-- two spellings, agreeing only because every registry happens to declare 4. Under a declared
-- closureMax of 6 a class at closure 5 is NOT fully closed, and would vanish from the view whose
-- entire job is residual risk -- an open class rendered closed. Found 2026-08-30.
-- Latent, never fired, because nothing has yet declared a bound other than 4, which is precisely
-- when nobody would be looking.
-- The two 4s were also DIFFERENT QUANTITIES that coincided. closureMax - closure is distance-from-
-- closed; the gain multiplier must outrank it, and closureMax is the correct one because
-- WHERE closure < closureMax bounds that term to 1..closureMax, giving each gain level a disjoint
-- band. bin/lib/pattern-core.mjs computes this identical priority in JS and is bound the same way.
-- Residual risk, ordered the way work should be picked up. loop/uca/cause are the PRIMARY stpa
-- entry (rank 1): the class judged in its own loop. The attention-loop reading lives in
-- taxonomy_open_stpa, which carries every rank.
CREATE VIEW IF NOT EXISTS taxonomy_open AS
  SELECT c.id, f.roman AS family, c.name, c.layer, c.closure, c.gain,
         (c.gain * ${b.closureMax} + (${b.closureMax} - c.closure)) AS priority, c.score_basis,
         s.loop, s.uca, s.cause
    FROM taxonomy_class c JOIN taxonomy_family f ON f.prefix = c.prefix
    LEFT JOIN taxonomy_stpa s ON s.class_id = c.id AND s.rank = 1
   WHERE c.closure < ${b.closureMax}
   ORDER BY priority DESC, c.id;
${v ? stpaSchemaFor(v) : ''}`;

const TABLES = ['taxonomy_stpa', 'taxonomy_attribution_class', 'taxonomy_attribution', 'taxonomy_remediation_class',
  'taxonomy_remediation', 'taxonomy_class', 'taxonomy_family', 'taxonomy_meta'];

// Kept for consumers that imported the constant before the bounds were declared as data. It carries
// no taxonomy_stpa: that table's CHECKs need a vocabulary, and only the registry may supply one.
export const SCHEMA = schemaFor({ closureMin: 0, closureMax: 4, gainMin: 0, gainMax: 4 });

// Fail closed on the fields the CHECKs are generated from. A build that skipped the stpa table on a
// registry without a vocabulary would leave --sql answering "no class is a late response" with full
// confidence, which is the absence-as-clean this catalogue is about.
export const MSG_NO_VOCABULARY = 'registry declares no stpaVocabulary — refusing to invent the loop/uca/cause vocabulary the taxonomy_stpa CHECK constraints enforce';
const noStpa = (id) => `${id}: no stpa entries — every class must carry a non-empty stpa array (uca "none" is a value, not an omission)`;

/**
 * Does the live file's shape differ from the schema this build would apply?
 *
 * The comparison is made by SQLite, not by parsing the DDL: the schema is applied to a scratch
 * in-memory database and both sides are read with the same PRAGMA. A regex over CREATE TABLE text
 * would be a second implementation of SQLite's own parser, and this repo has already paid for one
 * of those — the import guard whose comment stripper swallowed 1,375 lines and reported a clean
 * tree it had never read.
 */
export function schemaDrift(db, schemaSql) {
  const probe = new DatabaseSync(':memory:');
  try {
    probe.exec(schemaSql);
    const cols = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).join(',');
    for (const t of TABLES) {
      const live = cols(db, t);
      if (live === '') continue;            // absent is not drift: CREATE will make it
      if (live !== cols(probe, t)) return true;
    }
    return false;
  } finally {
    probe.close();
  }
}

function requireVocabulary(v) {
  if (!v || typeof v !== 'object') throw new Error(MSG_NO_VOCABULARY);
  for (const m of ['loops', 'uca', 'cause']) {
    if (!v[m] || typeof v[m] !== 'object' || Array.isArray(v[m]) || Object.keys(v[m]).length === 0)
      throw new Error(`registry stpaVocabulary.${m} is missing or empty — the taxonomy_stpa CHECK on ${m === 'loops' ? 'loop' : m} would admit nothing`);
  }
  return v;
}

export function build(db, doc, sourceHash) {
  const b = doc.scaleBounds;
  if (!b) throw new Error('registry declares no scaleBounds — refusing to invent the range the CHECK constraints enforce');
  const v = requireVocabulary(doc.stpaVocabulary);
  for (const c of doc.classes) if (!Array.isArray(c.stpa) || c.stpa.length === 0) throw new Error(noStpa(c.id));
  // The pragma is a no-op inside a transaction, so it precedes BEGIN.
  db.exec('PRAGMA foreign_keys = ON');
  // ONE TRANSACTION, or the constraints defeat their own purpose. build() deletes every row before
  // re-inserting, so a violation partway through used to leave the store holding a PREFIX of the
  // taxonomy — measured at 10 classes and 0 meta rows after an injected foreign-key failure. The
  // meta row carries the source hash, so --verify failed closed on it; --open and --sql did not,
  // and answered over the prefix as though it were the registry. A store that can hold a truncated
  // taxonomy and still answer is C12 with an index on it. DDL is transactional in SQLite, so the
  // stpa drop-and-recreate rides in the same transaction: a failed build cannot leave the previous
  // classes beside an empty stpa table.
  db.exec('BEGIN IMMEDIATE');
  try {
    // Views carry no data and nothing references them, so they are re-derived every build; an
    // IF NOT EXISTS view would keep a column list from before taxonomy_stpa existed.
    db.exec('DROP VIEW IF EXISTS taxonomy_open_stpa; DROP VIEW IF EXISTS taxonomy_open; DROP TABLE IF EXISTS taxonomy_stpa;');
    // CREATE TABLE IF NOT EXISTS CANNOT EVOLVE A SHAPE. When the registry grew a `predicate` column
    // the existing file kept the old twelve-column table, every build refused with "no column named
    // predicate", and the store froze at 97 classes while the registry moved to 179 — a projection
    // that can never catch up, failing loudly each time and therefore never fixed. The whole
    // taxonomy_* set is derived from the registry and nothing outside it references it, so a shape
    // change means recreate, not migrate.
    if (schemaDrift(db, schemaFor(b, v))) {
      for (const t of TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
    }
    db.exec(schemaFor(b, v));
    fill(db, doc, sourceHash);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { classes: doc.classes.length, families: doc.families.length };
}

function fill(db, doc, sourceHash) {
  // Drop rows rather than tables: a rebuild must not invalidate anything another domain in this
  // database has already referenced, and DELETE keeps the foreign keys enforced during the swap.
  for (const t of TABLES) db.exec(`DELETE FROM ${t}`);

  const fam = db.prepare('INSERT INTO taxonomy_family (prefix, roman, key, name, proposition) VALUES (?,?,?,?,?)');
  for (const f of doc.families) fam.run(f.prefix, f.roman, f.key, f.name, f.proposition);

  const cls = db.prepare(`INSERT INTO taxonomy_class
    (id, prefix, ordinal, name, machine, layer, description, predicate, analogy, example, closure, gain, score_basis)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const c of doc.classes) {
    const [, prefix, ord] = /^([A-Z])(\d+)$/.exec(c.id);
    cls.run(c.id, prefix, Number(ord), c.name, c.machine, c.layer, c.description, c.predicate, c.analogy, c.example,
      c.closure, c.gain, c.scoreBasis || '');
  }

  // Every entry lands with its rank; the CHECKs, not this loop, decide whether a value is in the
  // vocabulary, so a typo is refused by the store rather than silently mapped.
  const stpa = db.prepare('INSERT INTO taxonomy_stpa (class_id, rank, loop, uca, cause) VALUES (?,?,?,?,?)');
  for (const c of doc.classes) {
    c.stpa.forEach((e, i) => stpa.run(c.id, i + 1, e?.loop ?? null, e?.uca ?? null, e?.cause ?? null));
  }

  const rem = db.prepare('INSERT INTO taxonomy_remediation (rank, title, action, note, effort, gain, layer) VALUES (?,?,?,?,?,?,?)');
  const remCls = db.prepare('INSERT INTO taxonomy_remediation_class (rank, class_id, relation) VALUES (?,?,?)');
  for (const r of doc.remediations || []) {
    rem.run(r.rank, r.title, r.action, r.note, r.effort, r.gain, r.layer);
    for (const id of r.closes || []) remCls.run(r.rank, id, 'closes');
    for (const id of r.raises || []) remCls.run(r.rank, id, 'raises');
  }

  const att = db.prepare('INSERT INTO taxonomy_attribution (area, defect, mechanism, change, effort) VALUES (?,?,?,?,?)');
  const attCls = db.prepare('INSERT INTO taxonomy_attribution_class (area, class_id) VALUES (?,?)');
  for (const a of doc.attributionPlan || []) {
    att.run(a.area, a.defect, a.mechanism, a.change, a.effort);
    for (const id of a.closes || []) attCls.run(a.area, id);
  }

  const meta = db.prepare('INSERT INTO taxonomy_meta (key, value) VALUES (?,?)');
  meta.run('version', String(doc.version));
  meta.run('verifiedAgainst', doc.verifiedAgainst || '');
  meta.run('sourceSha256', sourceHash);
  meta.run('classes', String(doc.classes.length));
  meta.run('families', String(doc.families.length));
  meta.run('scoreProvenance', doc.scoreProvenance || '');
  // Stored as the JSON object, not flattened: the four fields are one witness statement.
  meta.run('stpaProvenance', doc.stpaProvenance ? JSON.stringify(doc.stpaProvenance) : '');
  meta.run('stpaEntries', String(doc.classes.reduce((n, c) => n + c.stpa.length, 0)));
}

const readSource = () => {
  const raw = readFileSync(jsonPath(), 'utf8');
  return { doc: JSON.parse(raw), hash: createHash('sha256').update(raw).digest('hex') };
};

const storedHash = (db) => {
  try {
    return db.prepare("SELECT value FROM taxonomy_meta WHERE key = 'sourceSha256'").get()?.value ?? null;
  } catch (e) {
    if (/no such table/.test(e.message)) return null;
    throw e;
  }
};

/**
 * A read-only connection, inside an open read transaction, whose snapshot was built from the registry
 * bytes read in this call — rebuilding first when the stored hash differs. It replaced a STALE
 * warning that printed and then answered anyway: measured, a query returned 179 classes while the
 * registry held 188, and the missing class read exactly like "no such class". Every failure throws
 * rather than answering from the old build: an absent, unreadable or unparseable registry, and a
 * registry the build refuses. The hash is re-read inside the transaction because a peer may rebuild
 * between our build and our read; the loop bound turns a registry that never settles into a refusal.
 */
export function openFresh({ file = dbPath(), source = readSource, attempts = 3 } = {}) {
  let rebuilt = false;
  for (let i = 0; i < attempts; i++) {
    const { doc, hash } = source();
    if (existsSync(file)) {
      const ro = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
      let ok = false;
      try {
        ro.exec('BEGIN');
        ok = storedHash(ro) === hash;
      } finally {
        if (!ok) ro.close();
      }
      if (ok) return { db: ro, hash, rebuilt };
    }
    const rw = new DatabaseSync(file, { timeout: 5000 });
    try { build(rw, doc, hash); } finally { rw.close(); }
    rebuilt = true;
  }
  throw new Error(`the registry changed ${attempts} times while the store was being rebuilt — no stable edition to answer from`);
}

// The CLI read path: a refusal is one line and exit 1, never an answer from a superseded build.
function openFreshOrExit() {
  try {
    const r = openFresh();
    if (r.rebuilt) console.error(`rebuilt the store from the registry (${r.hash.slice(0, 12)}) before answering`);
    return r.db;
  } catch (e) {
    const why = e.code === 'ENOENT' ? `no registry at ${jsonPath()}` : e.message;
    console.error(`refused: the store cannot be confirmed current — ${why}`);
    process.exit(1);
  }
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  if (process.argv.includes('--build')) {
    const { doc, hash } = readSource();
    const db = new DatabaseSync(dbPath());
    let n;
    try {
      n = build(db, doc, hash);
    } catch (e) {
      // The refusal names the field, on one line, with no stack: the reader is the person about to
      // edit the registry, and the message is the whole of what they need.
      db.close();
      console.error(`build refused: ${e.message}`);
      process.exit(1);
    }
    db.close();
    console.log(`built ${dbPath()} — v${doc.version}, ${n.classes} classes, ${n.families} families, source ${hash.slice(0, 12)}`);
    process.exit(0);
  }

  if (process.argv.includes('--verify')) {
    const { hash } = readSource();
    const db = new DatabaseSync(dbPath(), { readOnly: true });
    const row = db.prepare("SELECT value FROM taxonomy_meta WHERE key = 'sourceSha256'").get();
    db.close();
    if (!row) { console.error('taxonomy tables carry no source hash — rebuild with --build'); process.exit(1); }
    if (row.value !== hash) {
      console.error(`DRIFT: database was built from ${row.value.slice(0, 12)}, registry on disk is ${hash.slice(0, 12)} — rebuild with --build`);
      process.exit(1);
    }
    console.log(`in sync with the registry (${hash.slice(0, 12)})`);
    process.exit(0);
  }

  if (process.argv.includes('--open')) {
    const db = openFreshOrExit();
    const rows = db.prepare('SELECT * FROM taxonomy_open LIMIT 25').all();
    db.close();
    for (const r of rows) console.log(`${r.id.padEnd(4)} ${String(r.priority).padStart(2)}  closure ${r.closure} gain ${r.gain}  ${r.layer}  ${r.loop}:${r.uca}/${r.cause}  ${r.name}`);
    console.log(`${rows.length} shown of the classes below full closure`);
    process.exit(0);
  }

  const find = argOf('--find');
  if (find) {
    // Searches every field, not just description -- see the taxonomy_search view for why.
    // Prints EVERY row and states the count: this exists because a prior-art check on 2026-09-06
    // printed the first 8 of 12 hits and read the visible subset as the whole answer, missing the
    // one row that already held the mechanism. A truncated result set must never be the default.
    const db = openFreshOrExit();
    const rows = db.prepare(
      'SELECT id, name, closure, gain FROM taxonomy_search WHERE text LIKE ? ORDER BY prefix, ordinal',
    ).all('%' + String(find).toLowerCase() + '%');
    db.close();
    if (!rows.length) {
      console.log('no class matches ' + JSON.stringify(find) + ' in name, description, predicate, analogy, example or scoreBasis');
      console.log('An empty result is a reading, not a licence to mint -- the projection was confirmed current before this search.');
      process.exit(0);
    }
    for (const r of rows) console.log(r.id.padEnd(5) + ' ' + String(r.name).padEnd(46) + ' closure ' + r.closure + ' gain ' + r.gain);
    console.log(rows.length + ' class(es) matched -- all shown, none truncated.');
    process.exit(0);
  }

  const sql = argOf('--sql');
  if (sql) {
    // Read-only by construction AND by connection flag: the store is a projection, so a write here
    // could only ever produce a database that disagrees with its own source.
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) { console.error('--sql accepts SELECT/WITH only'); process.exit(2); }
    const db = openFreshOrExit();
    console.log(JSON.stringify(db.prepare(sql).all(), null, 2));
    db.close();
    process.exit(0);
  }

  console.error('usage: taxonomy-db.mjs --build | --verify | --open | --find <term> | --sql "<SELECT ...>"');
  console.error('  --find searches name, description, predicate, analogy, example and scoreBasis -- a');
  console.error('          description-only search reports gaps the registry does not have.');
  process.exit(2);
}

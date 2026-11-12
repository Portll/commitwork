// Database handles and the SQL handed to them (flow/static.mjs sqlEffects / extractDatabases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lexer.mjs';
import { maskFrom } from '../verify.mjs';
import { valueContext, exprAt, sqlEffects, looksLikeSql, sqlText, extractDatabases } from '../static.mjs';

const ctxOf = (src) => {
  const lex = classify(src);
  return { ctx: valueContext('bin/x.mjs', maskFrom(src, lex.spans).masked, lex.spans), line: lex.lineOf };
};
const run = (src) => {
  const { ctx, line } = ctxOf(src);
  return extractDatabases(ctx, { line });
};

test('sqlEffects: reads, writes and the tables of each statement kind', () => {
  // arrange
  const cases = [
    'SELECT a FROM t1 JOIN "t2" ON 1',
    'WITH c AS (SELECT * FROM src) SELECT * FROM c',
    'WITH c AS (SELECT 1) INSERT INTO dst SELECT * FROM c',
    'INSERT OR REPLACE INTO t (a) VALUES (?)',
    'INSERT INTO t SELECT * FROM u',
    'REPLACE INTO [t3] VALUES (1)',
    'UPDATE OR IGNORE t SET a = 1',
    'DELETE FROM t WHERE 1',
    'CREATE TABLE IF NOT EXISTS t (a)',
    'CREATE UNIQUE INDEX i ON t (a)',
    'CREATE TEMP VIEW v AS SELECT 1',
    'DROP TABLE IF EXISTS `t`; DROP VIEW v',
    'ALTER TABLE t ADD COLUMN b',
    'PRAGMA foreign_keys = ON; BEGIN; COMMIT',
    'WITH c AS (SELECT 1) UPDATE t SET a = 1',
    'WITH c AS (SELECT 1) DELETE FROM t',
    '-- a comment\nSELECT * FROM (SELECT 1) /* x */',
  ];
  // act
  const got = cases.map((c) => { const f = sqlEffects(c); return [f.reads.join(','), f.writes.join(',')]; });
  // assert
  assert.deepEqual(got, [
    ['t1,t2', ''], ['c,src', ''], ['c', 'dst'], ['', 't'], ['u', 't'], ['', 't3'], ['', 't'], ['', 't'],
    ['', 't'], ['', 't'], ['', 'v'], ['', 't,v'], ['', 't'], ['', ''], ['', 't'], ['', 't'], ['', ''],
  ]);
});

test('sqlEffects drops computed table names and reports the verbs it saw', () => {
  // arrange
  const sql = 'DROP TABLE IF EXISTS  __expr__ ; SELECT * FROM meta';
  // act
  const f = sqlEffects(sql);
  // assert
  assert.deepEqual(f, { reads: ['meta'], writes: [], readVerbs: ['SELECT'], writeVerbs: ['DROP'] });
});

test('looksLikeSql recognises a leading verb, even after a comment line', () => {
  // arrange
  const vs = ['select 1', '-- c\n  INSERT INTO t', 'git', 'selection', 42];
  // act
  const got = vs.map(looksLikeSql);
  // assert
  assert.deepEqual(got, [true, true, false, false, false]);
});

test('sqlText reads literals, templates with placeholders and const bindings', () => {
  // arrange
  const { ctx } = ctxOf("const Q = 'SELECT 1';\nX = Q; Y = `DROP TABLE ${t}`; Z = f(); W = `\\u{zz}${a}`; V = nope;");
  const at = (n) => exprAt(ctx, ctx.masked.indexOf(`${n} = `) + 4, ctx.masked.indexOf(';', ctx.masked.indexOf(`${n} = `)));
  // act
  const got = ['X', 'Y', 'Z', 'W', 'V'].map((n) => sqlText(ctx, at(n)));
  // assert
  assert.deepEqual(got, ['SELECT 1', 'DROP TABLE  __expr__ ', null, null, null]);
  assert.equal(sqlText(ctx, null), null);
});

test('a database handle with a literal path gets reads and writes edges with tables', () => {
  // arrange
  const src = [
    "import { DatabaseSync } from 'node:sqlite';",
    "const db = new DatabaseSync('reports/x.db');",
    "db.exec('CREATE TABLE t (a); INSERT INTO t VALUES (1)');",
    "const rows = db.prepare('SELECT * FROM t').all();",
    "db.exec('BEGIN');",
  ].join('\n');
  // act
  const r = run(src);
  // assert
  assert.deepEqual(r.edges.map((e) => [e.kind, e.target, e.tables, e.evidence]), [
    ['writes', 'reports/x.db', ['t'], 'bin/x.mjs:3 exec CREATE+INSERT t'],
    ['reads', 'reports/x.db', ['t'], 'bin/x.mjs:4 prepare SELECT t'],
  ]);
  assert.deepEqual(r.sites, []);
  assert.equal(r.consumed.size, 4);                       // the path and the three SQL literals
});

test('the nearest preceding handle of the same name wins; :memory: and joined paths resolve', () => {
  // arrange
  const src = [
    "function a() { const db = new DatabaseSync(':memory:'); db.exec('DELETE FROM m'); }",
    "function b() { const db = new Database(join(import.meta.dirname, 'b.db')); db.run('UPDATE u SET a = 1'); }",
    "function c() { db.get('SELECT 1 FROM early'); }",
  ].join('\n');
  // act
  const r = run(src);
  // assert
  assert.deepEqual(r.edges.map((e) => `${e.kind} ${e.target} ${e.tables}`), ['writes :memory: m', 'writes bin/b.db u', 'reads bin/b.db early']);
});

test('unresolved paths, handles and SQL are sites; a regex .exec is ignored', () => {
  // arrange
  const src = [
    'const db = new DatabaseSync(dbPath());',
    "db.prepare('SELECT * FROM t');",
    'db.exec(SQL.make);',
    "other.prepare('INSERT INTO z VALUES (1)');",
    "const RE = /x/; RE.exec('reports/a.json');",
    'const d2 = new DatabaseSync(join(DIR, "c.db"));',
    'const d3 = new DatabaseSync();',
    "other.get('SELECT 1');",
    "other.exec('BEGIN');",
  ].join('\n');
  // act
  const r = run(src);
  // assert
  assert.deepEqual(r.edges, []);
  assert.deepEqual(r.sites.map((s) => `${s.call}: ${s.reason}`), [
    'new DatabaseSync: database path computed dbPath()',
    'new DatabaseSync: database path joined onto an unknown directory',
    'new DatabaseSync: database path no path',
    'prepare: database path not resolved',
    'exec: computed SQL',
    'prepare: database handle not resolved',
  ]);
});

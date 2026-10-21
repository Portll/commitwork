// bin/test/graph.test.mjs — the relation store, built from synthetic fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build, openFresh, neighbours, path, withGraph, sessionNode, EXIT } from '../graph.mjs';
import { emptyIssuesDoc, mintIssue, claimIssue, closeIssue } from '../../monitor/issue-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'graph.mjs');
const AT = '2026-10-01T00:00:00.000Z';
const SESSION = 'fixture-session-0001';
const ENV_KEYS = ['CW_GRAPH_DB', 'CW_ISSUES', 'CW_ISSUES_JSON', 'CW_ISSUE_STORE', 'CW_REGISTRY', 'CW_APPROACH_TAXONOMY', 'CW_NOW', 'CW_REPORTS_ROOT', 'CW_MONITOR_OUT'];

function fixture({ issues = true, registry = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-graph-'));
  const ids = {};
  const env = { CW_GRAPH_DB: join(dir, 'out', 'graph.db'), CW_ISSUES: join(dir, 'issues.json'), CW_REGISTRY: join(dir, 'projects.json'), CW_NOW: AT };
  if (issues) {
    const doc = emptyIssuesDoc();
    const a = ids.a = mintIssue(doc, { area: 'alpha', repo: 'alpha-api', kind: 'code', severity: 'high', title: 'synthetic injection',
      source: { kind: 'scanner-row', key: 'sc:alpha-api|sastSemgrep|r1|src/a.js', tool: 'sastSemgrep', rule: 'r1' } }, AT).id;
    ids.b = mintIssue(doc, { area: 'alpha', repo: 'alpha-web', kind: 'vuln', severity: 'med', title: 'synthetic dependency',
      source: { kind: 'finding', key: 'f:alpha-web|osv|GHSA-0000|pkg|package.json', tool: 'osv', rule: null } }, AT).id;
    claimIssue(doc, a, { by: 'agent', sessionId: SESSION, at: AT });
    closeIssue(doc, a, { as: 'refuted', evidence: 'synthetic evidence for the fixture', sessionId: SESSION, at: AT });
    writeFileSync(env.CW_ISSUES, JSON.stringify(doc));
  }
  if (registry) {
    const reports = join(dir, 'reports');
    writeFileSync(env.CW_REGISTRY, JSON.stringify({
      reportsRoot: reports,
      areas: [{ slug: 'alpha', label: 'Alpha', out: 'alpha', primary: true, members: ['alpha-api', 'alpha-web'] },
        { slug: 'beta', label: 'Beta', out: 'beta', members: ['beta-svc'] }],
    }));
    mkdirSync(join(reports, 'alpha'), { recursive: true });
    writeFileSync(join(reports, 'alpha', 'rollup.json'), JSON.stringify({ repos: [
      { name: 'alpha-api', scanners: { sastSemgrep: { ran: true }, secrets: { ran: false } } },
      { name: 'alpha-web', scanners: { secrets: { ran: true } } },
    ] }));
  }
  return { dir, env, ids };
}

function withEnv(env, fn) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const edgesOf = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('SELECT src, rel, dst FROM edges').all().map((e) => `${e.src} ${e.rel} ${e.dst}`); } finally { db.close(); }
};

test('every edge kind is built from its source, and the session id never reaches the store', () => {
  const { env, ids } = fixture();
  withEnv(env, () => {
    const r = build();
    const edges = edgesOf(env.CW_GRAPH_DB);
    for (const want of [
      `finding:${ids.a} found-by lane:sastSemgrep`, `finding:${ids.a} in-repo repo:alpha-api`,
      `finding:${ids.b} found-by lane:osv`, 'repo:alpha-api in-area area:alpha', 'repo:alpha-web in-area area:alpha',
      'lane:sastSemgrep ran-on repo:alpha-api', 'lane:secrets ran-on repo:alpha-web',
      `${sessionNode(SESSION)} claimed finding:${ids.a}`,
    ]) assert.ok(edges.includes(want), want);
    assert.ok(!edges.includes('lane:secrets ran-on repo:alpha-api'), 'a lane that did not run is not an edge');
    assert.ok(edges.some((e) => /^lane:sastSemgrep covers class:/.test(e)), 'lane covers class from the approach taxonomy');
    assert.equal(r.status['lane-ran-on-repo'].areasWithoutRollup, 1);
    assert.equal(r.status['finding-classified-as-class'].status, 'not-built');
    assert.ok(!readFileSync(env.CW_GRAPH_DB).includes(SESSION), 'raw session id stored');
  });
});

test('an absent input leaves its edge kinds not built, with the reason', () => {
  const { env } = fixture({ issues: false, registry: false });
  withEnv(env, () => {
    const r = build();
    for (const k of ['finding-found-by-lane', 'finding-in-repo', 'session-claimed-finding', 'lane-ran-on-repo', 'repo-in-area']) {
      assert.equal(r.status[k].status, 'not-built', k);
      assert.ok(r.status[k].reason, k);
      assert.equal(r.status[k].edges, undefined, `${k} must not report a count`);
    }
    assert.equal(r.status['lane-covers-class'].status, 'built');
  });
});

test('the shipped example registry is not read as a fleet', () => {
  const { env } = fixture({ registry: false });
  withEnv({ ...env, CW_REGISTRY: join(HERE, '..', '..', 'monitor', 'projects.example.json') }, () => {
    assert.match(build().status['repo-in-area'].reason, /example/);
  });
});

test('a corrupt issue store refuses the build rather than building an empty graph', () => {
  const { env } = fixture();
  writeFileSync(env.CW_ISSUES, '{ not json');
  withEnv(env, () => assert.throws(() => build(), /not valid JSON/));
  const r = spawnSync(process.execPath, [CLI, 'build'], { env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(r.status, EXIT.UNREADABLE, r.stderr);
});

test('identical inputs build byte-identical stores', () => {
  const { env, dir } = fixture();
  withEnv(env, () => {
    build({ file: join(dir, 'a.db') });
    build({ file: join(dir, 'b.db') });
    assert.ok(readFileSync(join(dir, 'a.db')).equals(readFileSync(join(dir, 'b.db'))));
  });
});

test('a read rebuilds when an input changes, and only then', () => {
  const { env } = fixture();
  withEnv(env, () => {
    let o = openFresh(); o.db.close();
    assert.equal(o.rebuilt, true, 'no store yet');
    o = openFresh(); o.db.close();
    assert.equal(o.rebuilt, false);
    const doc = JSON.parse(readFileSync(env.CW_ISSUES, 'utf8'));
    mintIssue(doc, { area: 'beta', repo: 'beta-svc', kind: 'code', severity: 'low', title: 'later',
      source: { kind: 'scanner-row', key: 'sc:beta-svc|secrets|r2|x', tool: 'secrets', rule: 'r2' } }, AT);
    writeFileSync(env.CW_ISSUES, JSON.stringify(doc));
    const r = withGraph((db) => neighbours(db, 'repo:beta-svc'));
    assert.equal(r.graph.rebuilt, true);
    assert.equal(r.found, true);
  });
});

test('neighbours: depth, relation filter, absent node', () => {
  const { env, ids } = fixture();
  withEnv(env, () => {
    build();
    const r = withGraph((db) => ({
      one: neighbours(db, 'repo:alpha-api'),
      rel: neighbours(db, 'repo:alpha-api', { rel: 'ran-on' }),
      two: neighbours(db, 'area:alpha', { depth: 2 }),
      none: neighbours(db, 'repo:nowhere'),
    }));
    assert.deepEqual(r.one.neighbours.map((n) => `${n.direction} ${n.rel} ${n.id}`).sort(),
      [`in in-repo finding:${ids.a}`, 'in ran-on lane:sastSemgrep', 'out in-area area:alpha']);
    assert.deepEqual(r.rel.neighbours.map((n) => n.id), ['lane:sastSemgrep']);
    assert.ok(r.two.neighbours.some((n) => n.kind === 'finding' && n.distance === 2));
    assert.equal(r.none.found, false);
    assert.match(r.none.reason, /no node/);
  });
});

test('path joins a session to the area of the finding it claimed', () => {
  const { env } = fixture();
  withEnv(env, () => {
    build();
    const r = withGraph((db) => path(db, sessionNode(SESSION), 'area:alpha'));
    assert.equal(r.found, true);
    assert.deepEqual(r.nodes.map((n) => n.kind), ['session', 'finding', 'repository', 'area']);
    const none = withGraph((db) => path(db, 'area:alpha', 'area:beta', { depth: 2 }));
    assert.equal(none.found, false);
  });
});

test('the CLI reads CW_GRAPH_DB at call time and exits 20 for an absent node', () => {
  const { env } = fixture();
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' });
  const ok = run('query', 'neighbours', 'area:alpha', '--depth', '2');
  assert.equal(ok.status, EXIT.OK, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).found, true);
  assert.equal(run('query', 'neighbours', 'repo:nowhere').status, EXIT.NOT_FOUND);
  assert.equal(run('query', 'neighbours').status, EXIT.USAGE);
  assert.equal(run('query', 'neighbours', 'area:alpha', '--depth', 'x').status, EXIT.USAGE);
});

// C1 end to end for endpoints, databases, node scripts, append/tail and triggers: analyseSource and
// analyseRepo, i.e. through V8's parse and the mask-consistency floor.
//
// vm.SourceTextModule needs --experimental-vm-modules, so — as flow/test/static.test.mjs does —
// this file re-runs ITSELF in a child carrying the flag and asserts the child's own summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const EXPECTED_TESTS = 7;

if (typeof vm.SourceTextModule !== 'function') {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', '--test-reporter=spec', SELF],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: childEnv });
  test('the V8-backed endpoint/trigger tests ran in a child carrying --experimental-vm-modules', () => {
    assert.notEqual(r.status, null, `the child could not START (${r.signal || r.error})`);
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const pass = Number((/^ℹ pass (\d+)$/m.exec(out) || [])[1] ?? -1);
    const fail = Number((/^ℹ fail (\d+)$/m.exec(out) || [])[1] ?? -1);
    assert.ok(pass >= 0 && fail >= 0, `the child produced no test summary:\n${out.slice(-2000)}`);
    assert.equal(fail, 0, `child failures:\n${out.slice(-4000)}`);
    assert.ok(pass >= EXPECTED_TESTS, `child reported only ${pass} passing tests, expected >= ${EXPECTED_TESTS}`);
    assert.equal(r.status, 0, out.slice(-2000));
  });
} else {
  const { analyseSource, analyseRepo } = await import('../static.mjs');
  const edgesOf = (r) => r.edges.map((e) => `${e.kind} ${e.targetKind} ${e.target}`);

  test('NEGATIVE CONTROL — an endpoint, a database write and a node script are each found', async () => {
    // arrange
    const src = [
      "import { DatabaseSync } from 'node:sqlite';",
      "import { spawnSync } from 'node:child_process';",
      "await fetch('https://api.osv.dev/v1/query');",
      "const db = new DatabaseSync('reports/x.db');",
      "db.exec('INSERT INTO t VALUES (1)');",
      "spawnSync('node', ['bin/b.mjs']);",
    ].join('\n');
    // act
    const r = await analyseSource('bin/a.mjs', src);
    // assert
    assert.equal(r.state, 'analysed');
    const got = edgesOf(r);
    assert.ok(got.includes('connects endpoint https://api.osv.dev'), got.join(' | '));
    assert.ok(got.includes('writes database reports/x.db'), got.join(' | '));
    const spawn = r.edges.find((e) => e.kind === 'spawns');
    assert.deepEqual([spawn.target, spawn.scriptCandidates], ['node', ['bin/b.mjs', 'bin/bin/b.mjs']]);
  });

  test('SQL handed to db.exec is no longer a spawn target, and its literals are not artifacts', async () => {
    // arrange
    const src = [
      "import { DatabaseSync } from 'node:sqlite';",
      "const db = new DatabaseSync(':memory:');",
      "db.exec('CREATE TABLE reports (a)');",
      "db.exec('BEGIN');",
      "const RE = /x/; RE.exec('reports/a.json');",
    ].join('\n');
    // act
    const r = await analyseSource('bin/a.mjs', src);
    // assert
    assert.deepEqual(r.edges.filter((e) => e.kind === 'spawns'), []);
    assert.deepEqual(edgesOf(r), ['writes database :memory:']);
    assert.deepEqual(r.edges[0].tables, ['reports']);
  });

  test('append writers and tailing / polling readers are marked, by literal and by binding', async () => {
    // arrange
    const src = [
      "import { appendFileSync, createReadStream, createWriteStream, readFileSync, watch } from 'node:fs';",
      "const LOG = 'reports/events.jsonl';",
      "appendFileSync(LOG, 'x\\n');",
      "createWriteStream('reports/w.jsonl', { flags: 'a' });",
      "createReadStream('reports/w.jsonl');",
      "watch('reports/watched.json');",
      "setInterval(() => { readFileSync('reports/polled.json'); }, 1000);",
      'const rl = createReadStream(LOG);',
      "readFileSync('reports/once.json');",
    ].join('\n');
    // act
    const r = await analyseSource('bin/a.mjs', src);
    const mark = (k, t) => { const e = r.edges.find((x) => x.kind === k && x.target === t); return e ? { append: e.append, tail: e.tail } : null; };
    // assert
    assert.deepEqual(mark('writes', 'reports/events.jsonl'), { append: true, tail: undefined });
    assert.deepEqual(mark('reads', 'reports/events.jsonl'), { append: undefined, tail: true });
    assert.deepEqual(mark('writes', 'reports/w.jsonl'), { append: true, tail: undefined });
    assert.deepEqual(mark('reads', 'reports/w.jsonl'), { append: undefined, tail: true });
    assert.deepEqual(mark('reads', 'reports/watched.json'), { append: undefined, tail: true });
    assert.deepEqual(mark('reads', 'reports/polled.json'), { append: undefined, tail: true });
    assert.deepEqual(mark('reads', 'reports/once.json'), { append: undefined, tail: undefined });
    assert.deepEqual(r.triggers.timers.map((t) => t.evidence), ['bin/a.mjs:7 setInterval']);
    assert.deepEqual(r.triggers.watches.map((t) => t.evidence), ['bin/a.mjs:6 watch']);
  });

  test('servers, process.execPath spawns and unanalysable sites are recorded on the module', async () => {
    // arrange
    const src = [
      "import http from 'node:http';",
      "import * as cp from 'node:child_process';",
      'http.createServer(() => {}).listen(Number(process.env.P || 0));',
      "cp.spawnSync(process.execPath, [new URL('./b.mjs', import.meta.url).pathname]);",
      "cp.execFileSync(process.execPath, [fileURLToPath(new URL('./b.mjs', import.meta.url))]);",
      'fetch(`${base}/x`);',
    ].join('\n');
    // act
    const r = await analyseSource('bin/a.mjs', src);
    // assert
    const spawns = r.edges.filter((e) => e.kind === 'spawns');
    assert.deepEqual(edgesOf(r).filter((e) => !e.startsWith('touches')), ['listens endpoint listen:unknown', 'spawns process node', 'spawns process node']);
    assert.deepEqual(spawns.map((e) => e.scriptCandidates), [undefined, ['bin/b.mjs']]);
    assert.deepEqual(r.sites.map((s) => `${s.at} ${s.kind} ${s.reason}`), [
      'bin/a.mjs:6 connects computed URL',
      'bin/a.mjs:4 spawns script computed expression',
    ]);
  });

  test('analyseRepo: new node kinds, script edges, schedulers and site counts reach the graph', async () => {
    // arrange
    const root = mkdtempSync(join(tmpdir(), 'flow-c1-new-'));
    const put = (f, t) => { mkdirSync(join(root, f, '..'), { recursive: true }); writeFileSync(join(root, f), t); };
    put('bin/a.mjs', [
      "import { spawnSync } from 'node:child_process';",
      "import { DatabaseSync } from 'node:sqlite';",
      "spawnSync(process.execPath, ['bin/b.mjs']);",
      "spawnSync('node', ['bin/not-tracked.mjs']);",
      "await fetch('https://api.first.org/data');",
      "const db = new DatabaseSync('data/a.db');",
      "db.prepare('SELECT * FROM t').all();",
      'fetch(url);',
    ].join('\n'));
    put('bin/b.mjs', "import { createServer } from 'node:http';\ncreateServer().listen(7878);\nsetInterval(() => {}, 5);\n");
    put('.github/workflows/w.yml', "on:\n  schedule:\n    - cron: '0 3 * * *'\njobs:\n  j:\n    steps:\n      - run: node bin/b.mjs\n");
    const files = ['bin/a.mjs', 'bin/b.mjs'];
    const launchd = { cw: root, agents: [{ label: 'com.x.b', argv: ['node', join(root, 'bin/b.mjs')], schedule: '<key>StartInterval</key><integer>60</integer>' }] };
    // act
    const g = await analyseRepo({ root, files, env: { CW_NOW: '2026-11-12T00:00:00Z' }, triggers: { launchd } });
    const byId = (id) => g.edges.filter((e) => e.to === id || e.from === id);
    // assert
    const spawnNode = g.edges.find((e) => e.kind === 'spawns' && e.to === 'node:process:node');
    assert.equal(spawnNode.script, 'bin/b.mjs');
    assert.deepEqual(spawnNode.scripts, ['bin/b.mjs', 'bin/not-tracked.mjs']);
    assert.ok(g.edges.some((e) => e.kind === 'spawns' && e.from === 'node:module:bin/a.mjs' && e.to === 'node:module:bin/b.mjs' && e.script === 'bin/b.mjs'));
    assert.ok(!g.edges.some((e) => e.to === 'node:module:bin/not-tracked.mjs'));
    assert.deepEqual(byId('node:endpoint:https://api.first.org').map((e) => e.kind), ['connects']);
    assert.deepEqual(byId('node:endpoint:listen:7878').map((e) => [e.kind, e.from]), [['listens', 'node:module:bin/b.mjs']]);
    assert.deepEqual(byId('node:database:data/a.db').map((e) => [e.kind, e.tables]), [['reads', ['t']]]);
    const sched = g.nodes.filter((n) => n.kind === 'scheduler').map((n) => n.path).sort();
    assert.deepEqual(sched, ['launchd:com.x.b', 'timer:bin/b.mjs', 'workflow:.github/workflows/w.yml#schedule']);
    assert.deepEqual(g.nodes.find((n) => n.path === 'launchd:com.x.b').schedule, { type: 'StartInterval', seconds: 60 });
    assert.deepEqual(g.edges.filter((e) => e.kind === 'triggers').map((e) => `${e.from} ${e.to}`).sort(), [
      'node:scheduler:launchd:com.x.b node:module:bin/b.mjs',
      'node:scheduler:timer:bin/b.mjs node:module:bin/b.mjs',
      'node:scheduler:workflow:.github/workflows/w.yml#schedule node:module:bin/b.mjs',
    ]);
    for (const e of g.edges.filter((x) => ['connects', 'listens', 'triggers'].includes(x.kind) || x.to.startsWith('node:database:'))) {
      assert.equal(Object.keys(e)[0], 'v');
      assert.deepEqual([e.witness, e.existence], ['static', 'unknown']);
      assert.ok(e.evidence.every((ev) => /^\S+:\d+ \S+/.test(ev)), e.evidence.join());
    }
    assert.deepEqual(g.summary.nodesByKind.scheduler, 3);
    assert.deepEqual(g.summary.edgesByKind.triggers, 3);
    assert.equal(g.summary.unanalysableSites, 1);
    assert.deepEqual(g.summary.unanalysableSitesByKind, { 'connects: unresolved binding': 1 });
    assert.deepEqual(g.summary.sites, ['bin/a.mjs:8 connects fetch: unresolved url']);
    rmSync(root, { recursive: true, force: true });
  });

  test('analyseRepo: an unknown listen port is a node marked unknown', async () => {
    // arrange
    const root = mkdtempSync(join(tmpdir(), 'flow-c1-listen-'));
    writeFileSync(join(root, 's.mjs'), "import net from 'node:net';\nnet.createServer().listen(port);\n");
    // act
    const g = await analyseRepo({ root, files: ['s.mjs'], env: {}, triggers: { workflows: [], crontabs: [] } });
    // assert
    assert.equal(g.nodes.find((n) => n.id === 'node:endpoint:listen:unknown').unknown, true);
    rmSync(root, { recursive: true, force: true });
  });

  test('analyseRepo: imports, env keys, a const-bound database path and an unreadable file still work alongside', async () => {
    // arrange
    const root = mkdtempSync(join(tmpdir(), 'flow-c1-mixed-'));
    writeFileSync(join(root, 'c.mjs'), 'export const x = 1;\n');
    writeFileSync(join(root, 'a.mjs'), [
      "import { x } from './c.mjs';",
      "import { DatabaseSync } from 'node:sqlite';",
      "const k = process.env['CW_BRACKET'];",
      'const t = process.env.CW_DOT;',
      "const m = await import('./d.mjs');",
      "const P = 'data/k.db';",
      "const db = new DatabaseSync(P);",
      "db.exec('DELETE FROM q');",
    ].join('\n'));
    // act
    const g = await analyseRepo({ root, files: ['a.mjs', 'c.mjs', 'gone.mjs'], env: {}, triggers: { workflows: [], crontabs: [] } });
    // assert
    const from = (id) => g.edges.filter((e) => e.from === 'node:module:a.mjs' && e.to === id).map((e) => e.kind);
    assert.deepEqual(from('node:module:c.mjs'), ['reads']);
    assert.deepEqual(from('node:module:d.mjs'), ['reads']);
    assert.deepEqual(from('node:env:CW_BRACKET'), ['reads']);
    assert.deepEqual(from('node:env:CW_DOT'), ['reads']);
    assert.deepEqual(from('node:database:data/k.db'), ['writes']);
    assert.ok(!g.nodes.some((n) => n.path === 'data/k.db' && n.kind !== 'database'), 'the bound path literal is not also an artifact');
    assert.equal(g.modules.find((m) => m.path === 'gone.mjs').state, 'unreadable');
    rmSync(root, { recursive: true, force: true });
  });
}

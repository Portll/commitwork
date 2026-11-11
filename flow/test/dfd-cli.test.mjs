// The dfd command (flow/dfd-cli.mjs): its two sources, its filter, and the exit code for each way it
// declines. A refusal is asserted with what it wrote to stdout, which must be nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, parseArgs, EXIT, DEFAULT_MAX } from '../dfd-cli.mjs';
import { validateDfd } from '../../lib/dfd.mjs';
import { makeNode, makeEdge, nodeId } from '../graph.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', '..', 'lib', 'test', 'fixtures', 'dfd-synthetic.json');
const tmp = () => mkdtempSync(join(tmpdir(), 'flow-dfd-'));

function run(argv, env = {}) {
  const out = [];
  const err = [];
  const code = main(argv, { env, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } });
  return { code, out: out.join(''), err: err.join('') };
}

function graphFile(dir, name = 'flow.json') {
  const nodes = [makeNode('module', 'bin/a.mjs', { analysis: 'analysed' }), makeNode('module', 'lib/b.mjs', { analysis: 'analysed' }),
    makeNode('store', 'reports/x.json'), makeNode('env', 'CW_X')];
  const edges = [
    makeEdge(nodeId('module', 'bin/a.mjs'), nodeId('store', 'reports/x.json'), 'writes', { evidence: ['bin/a.mjs:1 writeFileSync'] }),
    makeEdge(nodeId('module', 'lib/b.mjs'), nodeId('store', 'reports/x.json'), 'reads', { evidence: ['lib/b.mjs:2 readFileSync'] }),
    makeEdge(nodeId('module', 'lib/b.mjs'), nodeId('env', 'CW_X'), 'reads', { evidence: ['lib/b.mjs:3 env'] }),
  ];
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify({ v: 1, generatedAt: '2026-11-11T00:00:00.000Z', nodes, edges }));
  return path;
}

// ── arguments ────────────────────────────────────────────────────────────────────────────────────

test('parseArgs reads a source, the filter and the numbers', () => {
  // arrange
  const argv = ['--graph', 'g.json', '--prefix', 'flow/', '--focus', 'n', '--hops', '2', '--max', '40', '--tests', '--imports', '--emit', 'model', '--fonts', 'none', '--title', 't', '--out', 'o.html'];

  // act
  const { opts, error } = parseArgs(argv);

  // assert
  assert.equal(error, undefined);
  assert.deepEqual(opts, { graph: 'g.json', prefix: 'flow/', focus: 'n', hops: 2, max: 40, tests: true, imports: true, emit: 'model', fonts: 'none', title: 't', out: 'o.html' });
});

test('parseArgs lets --graph stand without a path', () => {
  // arrange
  const last = ['--graph'];
  const followed = ['--graph', '--tests'];

  // act
  const a = parseArgs(last);
  const b = parseArgs(followed);

  // assert
  assert.deepEqual(a.opts, { graph: true });
  assert.deepEqual(b.opts, { graph: true, tests: true });
});

test('parseArgs names each malformed invocation', () => {
  // arrange
  const cases = [
    [[], /exactly one of --from/],
    [['--from', 'a', '--graph'], /exactly one of --from/],
    [['--from'], /--from needs a value/],
    [['stray'], /unknown argument stray/],
    [['--nope'], /unknown argument --nope/],
    [['--from', 'a', '--hops', 'two'], /--hops takes a whole number, got two/],
    [['--from', 'a', '--max', '-1'], /--max takes a whole number/],
    [['--from', 'a', '--emit', 'png'], /--emit takes one of html, model, analysis/],
    [['--from', 'a', '--fonts', 'comic'], /--fonts takes one of inline, none, served/],
  ];

  // act
  const errors = cases.map(([argv]) => parseArgs(argv).error);

  // assert
  cases.forEach(([, re], i) => assert.match(errors[i], re));
});

// ── from a dfd file ──────────────────────────────────────────────────────────────────────────────

test('a dfd file renders to stdout as one HTML page', () => {
  // arrange
  const argv = ['--from', FIXTURE, '--fonts', 'none'];

  // act
  const r = run(argv);

  // assert
  assert.equal(r.code, EXIT.OK);
  assert.equal(r.err, '');
  assert.match(r.out, /^<!doctype html>/);
  assert.match(r.out, /<svg class="dfd"/);
});

test('--out writes the page whole, leaves no temp file and prints one line', () => {
  // arrange
  const dir = tmp();
  const out = join(dir, 'deep', 'page.html');

  // act
  const r = run(['--from', FIXTURE, '--out', out]);

  // assert
  assert.equal(r.code, EXIT.OK);
  assert.equal(r.out, `dfd: 16 elements, 20 flows -> ${out} (html)\n`);
  assert.match(readFileSync(out, 'utf8'), /url\("data:font\/woff2;base64,/, 'the default page carries its fonts');
  assert.deepEqual(readdirSync(join(dir, 'deep')), ['page.html']);
});

test('--emit model returns the document and --emit analysis the analysis', () => {
  // arrange
  const title = 'Renamed';

  // act
  const model = run(['--from', FIXTURE, '--emit', 'model', '--title', title]);
  const analysis = run(['--from', FIXTURE, '--emit', 'analysis']);

  // assert
  assert.equal(model.code, EXIT.OK);
  assert.equal(JSON.parse(model.out).title, title);
  assert.deepEqual(validateDfd(JSON.parse(model.out)).errors, []);
  assert.deepEqual(JSON.parse(analysis.out).feedback.map((f) => f.flow), [10, 11]);
});

test('the filter narrows a dfd file and the page says it is a subset', () => {
  // arrange
  const argv = ['--from', FIXTURE, '--focus', 'ingest', '--hops', '1', '--emit', 'model'];

  // act
  const r = run(argv);
  const m = JSON.parse(r.out);

  // assert
  assert.equal(r.code, EXIT.OK);
  assert.deepEqual(m.nodes.map((n) => n.id), ['events', 'ingest', 'bronze']);
  assert.equal(m.source.filter.nodesOmitted, 13);
});

test('an invalid document exits 20 and lists what is wrong', () => {
  // arrange
  const dir = tmp();
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process', label: 'a' }], flows: [{ from: 'a', to: 'zz', mode: 'sync' }] }));

  // act
  const r = run(['--from', bad]);

  // assert
  assert.equal(r.code, EXIT.INVALID);
  assert.equal(r.out, '');
  assert.match(r.err, /not a valid dfd@1 document:\n {2}dfd: flows\[0\]\.to names "zz"/);
});

test('an absent or corrupt input exits 21', () => {
  // arrange
  const dir = tmp();
  const corrupt = join(dir, 'corrupt.json');
  writeFileSync(corrupt, '{ "v": 1,');

  // act
  const absent = run(['--from', join(dir, 'none.json')]);
  const broken = run(['--from', corrupt]);

  // assert
  assert.equal(absent.code, EXIT.INPUT);
  assert.match(absent.err, /dfd document not found at /);
  assert.equal(broken.code, EXIT.INPUT);
  assert.match(broken.err, /flow store corrupt/);
  assert.equal(absent.out + broken.out, '');
});

test('a usage error exits 2 and shows the usage line', () => {
  // arrange
  const argv = ['--from', FIXTURE, '--emit', 'pdf'];

  // act
  const r = run(argv);

  // assert
  assert.equal(r.code, EXIT.USAGE);
  assert.match(r.err, /--emit takes one of[\s\S]*usage: node flow\/dfd-cli\.mjs/);
});

test('a filter that matches nothing, or a model past --max, exits 22 and draws nothing', () => {
  // arrange
  const nothing = ['--from', FIXTURE, '--prefix', 'no/such/'];
  const tooBig = ['--from', FIXTURE, '--max', '5'];

  // act
  const a = run(nothing);
  const b = run(tooBig);
  const asModel = run([...tooBig, '--emit', 'model']);

  // assert
  assert.equal(a.code, EXIT.SIZE);
  assert.match(a.err, /the filter matched no node \(prefix "no\/such\/", focus null\)/);
  assert.equal(b.code, EXIT.SIZE);
  assert.match(b.err, /16 elements is more than --max 5/);
  assert.equal(a.out + b.out, '');
  assert.equal(asModel.code, EXIT.OK, 'the limit is on drawing, not on emitting the model');
  assert.equal(DEFAULT_MAX, 150);
});

// ── from the flow graph ──────────────────────────────────────────────────────────────────────────

test('--graph <file> runs the adapter and draws the result', () => {
  // arrange
  const path = graphFile(tmp());

  // act
  const page = run(['--graph', path, '--fonts', 'none']);
  const model = JSON.parse(run(['--graph', path, '--emit', 'model', '--prefix', 'bin/', '--title', 'bin only']).out);

  // assert
  assert.equal(page.code, EXIT.OK);
  assert.match(page.out, /Producer: <code>flow-graph<\/code>\. Flow graph of 4 nodes and 3 edges/);
  assert.equal(model.title, 'bin only');
  assert.deepEqual(model.nodes.map((n) => n.label), ['bin/a.mjs', 'reports/x.json']);
  assert.equal(model.source.filter.prefix, 'bin/');
});

test('--graph without a path reads the store CW_HARNESS_STORE names', () => {
  // arrange
  const dir = tmp();
  graphFile(dir);

  // act
  const found = run(['--graph', '--emit', 'model'], { CW_HARNESS_STORE: dir });
  const missing = run(['--graph'], { CW_HARNESS_STORE: join(dir, 'empty') });

  // assert
  assert.equal(found.code, EXIT.OK);
  assert.equal(JSON.parse(found.out).nodes.length, 4);
  assert.equal(missing.code, EXIT.INPUT);
  assert.match(missing.err, /flow graph not found at .*flow\.json — run `node flow\/static\.mjs` to write it/);
});

test('a file that is not a flow graph exits 21, and a graph with nothing to draw exits 20', () => {
  // arrange
  const dir = tmp();
  const notGraph = join(dir, 'x.json');
  const empty = join(dir, 'empty.json');
  writeFileSync(notGraph, JSON.stringify({ nodes: {} }));
  writeFileSync(empty, JSON.stringify({ v: 1, nodes: [], edges: [] }));

  // act
  const a = run(['--graph', notGraph]);
  const b = run(['--graph', empty]);

  // assert
  assert.equal(a.code, EXIT.INPUT);
  assert.match(a.err, /is not a flow graph \(no nodes and edges arrays\)/);
  assert.doesNotMatch(a.err, /run `node flow\/static\.mjs`/);
  assert.equal(b.code, EXIT.INVALID);
  assert.match(b.err, /not a valid dfd@1 document/);
});

test('run as a command it exits with main\'s code', () => {
  // arrange
  const cli = join(HERE, '..', 'dfd-cli.mjs');

  // act
  const ok = spawnSync(process.execPath, [cli, '--from', FIXTURE, '--emit', 'analysis'], { encoding: 'utf8' });
  const bad = spawnSync(process.execPath, [cli], { encoding: 'utf8' });

  // assert
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).v, 1);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /^dfd: give exactly one of/);
});

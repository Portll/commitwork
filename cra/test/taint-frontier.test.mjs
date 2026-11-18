// node --test cra/test/taint-frontier.test.mjs — where untrusted data leaves the code CodeQL follows.
//
// The fixtures are a real CodeQL run, trimmed (cra/test/fixtures/taint-frontier/PROVENANCE.json):
// the same call is UNCLAIMED when its library is unmodelled and CLAIMED once a model makes a taint
// route end at it — while the frontier query lists it both times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { buildFrontier, parseFrontierMessage, frontierCall, sinkSitesOf } from '../taint-frontier.mjs';

const FX = join(resolve(dirname(fileURLToPath(import.meta.url))), 'fixtures', 'taint-frontier');

test('an unmodelled library call is UNCLAIMED: the lane said nothing, and that is not clean', () => {
  const f = buildFrontier({ dir: join(FX, 'plain') });
  assert.equal(f.state, 'ok');
  assert.deepEqual([f.totals.calls, f.totals.claimed, f.totals.unclaimed], [1, 0, 1]);
  const [call] = f.repos.fx.calls;
  assert.equal(call.api, 'weird-db-client.raw()');
  assert.equal(call.param, 'param 0');
  assert.equal(call.source, 'req.query.id');
  assert.equal(call.claimed, false);
  assert.deepEqual(f.apis, [{ api: 'weird-db-client.raw()', calls: 1, unclaimed: 1, repos: 1, files: 1 }]);
});

test('the SAME call is CLAIMED once a taint route ends at it — the frontier lists it either way', () => {
  const f = buildFrontier({ dir: join(FX, 'modelled') });
  assert.deepEqual([f.totals.calls, f.totals.claimed, f.totals.unclaimed], [1, 1, 0]);
  assert.equal(f.repos.fx.calls[0].claimed, true);
});

test('a CodeQL lane with no frontier record is NOT-RUN, never an empty frontier', () => {
  const T = mkdtempSync(join(tmpdir(), 'fr-'));
  try {
    mkdirSync(join(T, 'r'));
    copyFileSync(join(FX, 'plain', 'fx', 'codeql.sarif'), join(T, 'r', 'codeql-java.sarif'));
    const f = buildFrontier({ dir: T });
    assert.equal(f.repos.r.languages.java.state, 'not-run');
    assert.equal(f.totals.byState['not-run'], 1);
    assert.equal(f.totals.calls, 0);
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('a record that failed, or a frontier SARIF that is gone, keeps its own state', () => {
  const T = mkdtempSync(join(tmpdir(), 'fr-'));
  try {
    mkdirSync(join(T, 'a')); mkdirSync(join(T, 'b')); mkdirSync(join(T, 'c'));
    writeFileSync(join(T, 'a', 'codeql-frontier-go.json'), JSON.stringify({ state: 'failed', reason: 'codeql database analyze exited 2' }));
    writeFileSync(join(T, 'b', 'codeql-frontier-python.json'), JSON.stringify({ state: 'ran', sarif: 'codeql-frontier-python.sarif' }));
    writeFileSync(join(T, 'c', 'codeql-frontier-ruby.json'), '{ not json');
    const f = buildFrontier({ dir: T });
    assert.equal(f.repos.a.languages.go.state, 'failed');
    assert.match(f.repos.a.languages.go.reason, /exited 2/);
    assert.equal(f.repos.b.languages.python.state, 'sarif-absent', 'a run whose output is missing is not a run that found nothing');
    assert.equal(f.repos.c.languages.ruby.state, 'unreadable');
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('a sweep directory that is gone is ABSENT; one that cannot be listed is UNREADABLE', () => {
  assert.equal(buildFrontier({ dir: join(tmpdir(), `fr-gone-${process.pid}`) }).state, 'absent');
  const T = mkdtempSync(join(tmpdir(), 'fr-'));
  try {
    writeFileSync(join(T, 'f'), 'x');
    assert.equal(buildFrontier({ dir: join(T, 'f') }).state, 'unreadable');
  } finally { rmSync(T, { recursive: true, force: true }); }
});

test('the message parser reads the query\'s select text, and refuses anything else', () => {
  assert.deepEqual(parseFrontierMessage('Call to weird-db-client.raw() \\[param 0\\] with untrusted data from [req.query.id](1).'),
    { api: 'weird-db-client.raw()', param: 'param 0', source: 'req.query.id' });
  assert.deepEqual(parseFrontierMessage('Call to java.io.PrintWriter.println(String) [param 0] with untrusted data from [getParameter(...)](1).'),
    { api: 'java.io.PrintWriter.println(String)', param: 'param 0', source: 'getParameter(...)' });
  assert.equal(parseFrontierMessage('Something else entirely.'), null);
  const unparsed = frontierCall({ message: { text: 'odd' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 1 } } }] }, sinkSitesOf([]));
  assert.equal(unparsed.api, null);
  assert.equal(unparsed.message, 'odd', 'an unparsed call keeps its text instead of a guessed api');
});

test('the join is exact on region: a sink one column away does not claim the call', () => {
  const sinkAt = (col) => sinkSitesOf([{ codeFlows: [{ threadFlows: [{ locations: [
    { location: { physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 4, startColumn: col, endColumn: 20 } } } },
  ] }] }] }]);
  const call = { message: { text: 'Call to x.y() [param 0] with untrusted data from [s](1).' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 4, startColumn: 5, endColumn: 20 } } }] };
  assert.equal(frontierCall(call, sinkAt(5)).claimed, true);
  assert.equal(frontierCall(call, sinkAt(6)).claimed, false);
  // an engine that gave no columns joins on file and line
  const noCols = { ...call, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.js' }, region: { startLine: 4 } } }] };
  assert.equal(frontierCall(noCols, sinkAt(6)).claimed, true);
});

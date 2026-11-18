// node --test bin/test/codeql-frontier.test.mjs — the frontier runner's decisions, CodeQL injected.
// The real run is recorded in cra/test/fixtures/taint-frontier/PROVENANCE.json; this pins what the
// runner does around it: which query, which packs, and that every way of not running is recorded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runFrontier, frontierSuite, modelArgs, FRONTIER_QUERY, NO_FRONTIER_QUERY } from '../codeql-frontier.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const harness = (files = {}, runResult = { status: 0, stdout: '', stderr: '' }, dbExists = true) => {
  const written = {};
  const calls = [];
  return {
    written, calls,
    opts: {
      reportDir: 'R', bin: 'codeql-test',
      exists: () => dbExists,
      write: (p, t) => { written[p.replace(/\\/g, '/')] = t; },
      run: (cmd, args) => { calls.push([cmd, ...args]); return runResult; },
    },
    files,
  };
};

test('the query is selected by @id from the language pack, never by a path inside it', () => {
  assert.equal(frontierSuite('csharp'), '- queries: .\n  from: codeql/csharp-queries\n- include:\n    id: cs/untrusted-data-to-external-api\n');
  assert.match(frontierSuite('javascript-typescript'), /from: codeql\/javascript-queries\n- include:\n    id: js\/untrusted-data-to-external-api/);
  assert.equal(frontierSuite('ruby'), null);
});

test('a ran query is recorded as ran, with its output named', () => {
  const h = harness();
  const rec = runFrontier('python', 'DB', h.opts);
  assert.equal(rec.state, 'ran');
  assert.equal(rec.query, 'py/untrusted-data-to-external-api');
  const [cmd, ...args] = h.calls[0];
  assert.equal(cmd, 'codeql-test');
  assert.deepEqual(args.slice(0, 3), ['database', 'analyze', 'DB']);
  assert.ok(args.includes('--format=sarif-latest'));
  assert.ok(args.some((a) => a.replace(/\\/g, '/') === '--output=R/codeql-frontier-python.sarif'));
  assert.ok(h.written['R/codeql-frontier-python.json'], 'the record is written');
  assert.ok(h.written['R/codeql-frontier-python.qls'], 'the suite is written beside it');
});

test('a failed analyze is FAILED with its last line, never an empty frontier', () => {
  const h = harness({}, { status: 2, stdout: '', stderr: 'Running queries\nA fatal error occurred: out of memory\n' });
  const rec = runFrontier('go', 'DB', h.opts);
  assert.equal(rec.state, 'failed');
  assert.equal(rec.exit, 2);
  assert.match(rec.reason, /out of memory/);
});

test('a binary that cannot start is FAILED, naming why', () => {
  const h = harness({}, { status: null, error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) });
  const rec = runFrontier('java', 'DB', h.opts);
  assert.equal(rec.state, 'failed');
  assert.match(rec.reason, /could not be started: ENOENT/);
});

test('no database, and a language with no query, are each recorded and nothing is run', () => {
  const a = harness({}, undefined, false);
  assert.equal(runFrontier('cpp', 'DB', a.opts).state, 'no-database');
  assert.equal(a.calls.length, 0);
  for (const lang of NO_FRONTIER_QUERY) {
    const b = harness();
    const rec = runFrontier(lang, 'DB', b.opts);
    assert.equal(rec.state, 'unsupported');
    assert.match(rec.reason, new RegExp(`no untrusted-data-to-external-api query for ${lang}`));
    assert.equal(b.calls.length, 0);
  }
});

test('the repository\'s own model pack is loaded when the lane loaded it — its sources are sources here', () => {
  const read = (p) => {
    if (p.replace(/\\/g, '/').endsWith('R/codeql-java-models.json')) return JSON.stringify({ applied: true, pack: 'commitwork-models/x-java' });
    throw Object.assign(new Error('nope'), { code: 'ENOENT' });
  };
  const m = modelArgs('R', 'java', read);
  assert.equal(m.state, 'applied');
  assert.deepEqual(m.args.filter((a) => !a.includes('codeql-models')), ['--additional-packs', '--model-packs', 'commitwork-models/x-java']);
  assert.equal(modelArgs('R', 'go', read).state, 'none');
  const broken = modelArgs('R', 'go', () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); });
  assert.equal(broken.state, 'unreadable', 'a record that cannot be read is not "no models"');
});

test('every CodeQL lane with a frontier query runs the frontier, after analyze and before the database is removed', () => {
  const m = JSON.parse(readFileSync(join(REPO, 'manifests', 'security-baseline.json'), 'utf8'));
  const lanes = m.checks.filter((c) => /^sast-codeql/.test(c.id));
  assert.ok(lanes.length >= 9);
  for (const c of lanes) {
    const cmd = (c.local || []).join('\n');
    const lang = (/codeql-model-pack\.mjs" ([a-z-]+)\)/.exec(cmd) || [])[1];
    assert.ok(lang, `${c.id}: the lane's language was found`);
    const at = cmd.indexOf('bin/codeql-frontier.mjs');
    if (!FRONTIER_QUERY[lang]) { assert.equal(at, -1, `${c.id}: ${lang} has no frontier query to run`); continue; }
    assert.ok(at > -1, `${c.id} (${lang}) does not run bin/codeql-frontier.mjs`);
    assert.ok(cmd.indexOf(`codeql-frontier.mjs" ${lang} `) > -1, `${c.id}: the frontier runs for ${lang}`);
    const analyze = cmd.indexOf('codeql database analyze');
    assert.ok(analyze > -1 && analyze < at, `${c.id}: the frontier runs after analyze`);
    const rm = cmd.indexOf('rm -rf');
    if (rm > -1) assert.ok(at < rm, `${c.id}: the frontier runs before the database is removed`);
  }
});

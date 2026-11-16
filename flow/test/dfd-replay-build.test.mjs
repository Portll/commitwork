// flow/dfd-replay-build.mjs: the replay page builder. Files and streams are injected; nothing here
// touches the disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, parseArgs, EXIT, USAGE } from '../dfd-replay-build.mjs';
import { MODEL } from '../../lib/test/fixtures/dfd-replay-model.mjs';

const sink = () => { const out = []; return { out, write: (s) => { out.push(s); return true; }, text: () => out.join('') }; };
const run = (argv, files, extra = {}) => {
  const stdout = sink(); const stderr = sink(); const written = new Map();
  const read = (p) => { if (!files.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' }); return files.get(p); };
  const code = main(argv, { stdout, stderr, read, write: (p, d) => written.set(p, d), ...extra });
  return { code, out: stdout.text(), err: stderr.text(), written };
};
const DOC = () => new Map([['doc.json', JSON.stringify(MODEL())]]);

test('a document becomes a page, with one line per step and a summary', () => {
  // arrange
  const files = DOC();
  // act
  const r = run(['doc.json', 'out.html', '--title', 'Parcel replay', '--label', 'synthetic', '--chip', 'six issues', '--as-of', '2026-11-14'], files);
  // assert
  assert.equal(r.code, EXIT.OK);
  assert.equal(r.err, '');
  const html = r.written.get('out.html');
  assert.match(html, /^<!DOCTYPE html>/i);
  assert.ok(html.includes('Parcel replay') && html.includes('six issues') && html.includes('synthetic'));
  assert.match(r.out, /^step 0: \d+ open, \d+ dealt with · original position, unfixed\n/);
  assert.match(r.out, /out\.html: \d+ bytes · \d+ elements \(\d+ drawable\) · \d+ flows · \d+ issues · \d+ change sets · \d+ files\n$/);
});

test('--help prints usage and succeeds; bad arguments are a usage error', () => {
  // arrange
  const cases = [[], ['only.json'], ['a', 'b', 'c'], ['a', 'b', '--nope'], ['a', 'b', '--title']];
  // act
  const help = run(['--help'], DOC());
  const bad = cases.map((argv) => run(argv, DOC()));
  // assert
  assert.deepEqual([help.code, help.out], [EXIT.OK, `${USAGE}\n`]);
  assert.deepEqual(bad.map((r) => r.code), cases.map(() => EXIT.USAGE));
  assert.deepEqual(bad.map((r) => r.err.split('\n')[0]), ['needs one document and one output path', 'needs one document and one output path', 'needs one document and one output path', 'unknown option --nope', '--title needs a value']);
  assert.ok(bad.every((r) => r.written.size === 0));
});

test('parseArgs keeps page options apart from the verdicts path', () => {
  // arrange
  const argv = ['-h'];
  // act
  const h = parseArgs(argv);
  const p = parseArgs(['in', 'out', '--verdicts', 'v.json', '--as-of', 'now']);
  const q = parseArgs(['in', 'out']);
  // assert
  assert.deepEqual(h, { help: true });
  assert.deepEqual(p, { input: 'in', output: 'out', verdicts: 'v.json', page: { asOf: 'now' } });
  assert.deepEqual(q, { input: 'in', output: 'out', page: {} });
});

test('an absent or unreadable input is an input error; an invalid document is refused', () => {
  // arrange
  const files = new Map([['bad.json', '{ not json'], ['wrong.json', JSON.stringify({ v: 1, kind: 'dfd', nodes: [{ id: 'a', kind: 'process' }], flows: [{ from: 'a', to: 'gone' }] })]]);
  // act
  const absent = run(['nope.json', 'out.html'], files);
  const broken = run(['bad.json', 'out.html'], files);
  const wrong = run(['wrong.json', 'out.html'], files);
  // assert
  assert.deepEqual([absent.code, absent.err], [EXIT.INPUT, 'nope.json: absent\n']);
  assert.equal(broken.code, EXIT.INPUT);
  assert.match(broken.err, /^bad\.json: /);
  assert.equal(wrong.code, EXIT.INVALID);
  assert.match(wrong.err, /^wrong\.json: not a valid dfd@1\n {2}schema: nodes\[0\]/);
  assert.ok([absent, broken, wrong].every((r) => r.written.size === 0));
});

test('verdicts as a list or as a file with pull requests are applied and counted', () => {
  // arrange
  const files = DOC();
  files.set('list.json', JSON.stringify([{ id: 'H6', verdict: 'fixed', reason: 'bounded' }, { id: 'nobody', verdict: 'fixed' }, { id: 'H7', verdict: 'maybe' }]));
  files.set('file.json', JSON.stringify({ prs: [{ id: 'pr-9', title: 'Late fix' }], verdicts: [{ id: 'H6', verdict: 'fixed', pr: 'pr-9' }] }));
  files.set('null.json', 'null');
  // act
  const list = run(['doc.json', 'a.html', '--verdicts', 'list.json'], files);
  const file = run(['doc.json', 'b.html', '--verdicts', 'file.json'], files);
  const none = run(['doc.json', 'c.html', '--verdicts', 'null.json'], files);
  // assert
  assert.equal(list.code, EXIT.OK);
  assert.match(list.out, /^verdicts: 1 applied, 1 naming no issue, 1 ignored\n/);
  assert.equal(file.code, EXIT.OK);
  assert.match(file.out, /^verdicts: 1 applied, 0 naming no issue, 0 ignored\n/);
  assert.ok(file.written.get('b.html').includes('Late fix'));
  assert.match(none.out, /^verdicts: 0 applied, 0 naming no issue, 0 ignored\n/);
});

test('an absent verdicts file is an input error; verdicts that break the document are refused', () => {
  // arrange
  const files = DOC();
  files.set('v.json', '[]');
  const breaking = (model) => ({ model: { ...model, findings: [...model.findings, { id: 'Z', at: { node: 'gone' } }] }, applied: 1, unmatched: [], ignored: [] });
  // act
  const absent = run(['doc.json', 'out.html', '--verdicts', 'missing.json'], files);
  const broken = run(['doc.json', 'out.html', '--verdicts', 'v.json'], files, { apply: breaking });
  // assert
  assert.deepEqual([absent.code, absent.err], [EXIT.INPUT, 'missing.json: absent\n']);
  assert.equal(broken.code, EXIT.INVALID);
  assert.match(broken.err, /^doc\.json with v\.json: not a valid dfd@1\n/);
  assert.ok([absent, broken].every((r) => r.written.size === 0));
});

test('a page that cannot be written is an input error, after nothing is printed to stdout', () => {
  // arrange
  const files = DOC();
  const write = () => { throw new Error('read-only file system'); };
  // act
  const r = run(['doc.json', '/ro/out.html'], files, { write });
  // assert
  assert.deepEqual([r.code, r.err, r.out], [EXIT.INPUT, '/ro/out.html: read-only file system\n', '']);
});

test('by default the document is read from disk and the page written atomically', () => {
  // arrange
  const doc = fileURLToPath(new URL('../../lib/test/fixtures/dfd-synthetic.json', import.meta.url));
  const out = join(mkdtempSync(join(tmpdir(), 'replay-')), 'page.html');
  const stdout = sink(); const stderr = sink();
  // act
  const code = main([doc, out], { stdout, stderr });
  // assert
  assert.deepEqual([code, stderr.text()], [EXIT.OK, '']);
  assert.match(readFileSync(out, 'utf8'), /^<!DOCTYPE html>/i);
});

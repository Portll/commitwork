// commitwork dfd --view record (flow/dfd-cli.mjs): the flag, what it refuses, and the page it writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, main, VIEWS } from '../dfd-cli.mjs';
import { RECORD, SINKS } from '../../lib/test/fixtures/dfd-record-model.mjs';

const io = () => { const out = []; const err = []; return { out, err, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } }; };

test('record is a view, and it takes no --collapse', () => {
  // Arrange
  const cases = [['--from', 'x.json', '--view', 'record'], ['--from', 'x.json', '--view', 'record', '--collapse', 'g']];
  // Act
  const got = cases.map((argv) => parseArgs(argv));
  // Assert
  assert.ok(VIEWS.includes('record'));
  assert.equal(got[0].error, undefined);
  assert.equal(got[0].opts.view, 'record');
  assert.equal(got[1].error, '--view record draws every node in its lane, so it takes no --collapse');
});

test('--view record writes its page whatever --max says, with the title given and the counts and layout faults on stdout', async () => {
  // Arrange
  const dir = mkdtempSync(join(tmpdir(), 'flow-dfd-record-'));
  writeFileSync(join(dir, 'm.json'), JSON.stringify(RECORD()));
  writeFileSync(join(dir, 's.json'), JSON.stringify(SINKS()));
  const a = io();
  const b = io();
  // Act
  const code = await main(['--from', join(dir, 'm.json'), '--view', 'record', '--max', '2', '--title', 'Parcel record', '--out', join(dir, 'r.html')], a);
  const html = readFileSync(join(dir, 'r.html'), 'utf8');
  const sinks = await main(['--from', join(dir, 's.json'), '--view', 'record', '--out', join(dir, 's.html')], b);
  // Assert
  assert.equal(code, 0, a.err.join(''));
  assert.match(a.out.join(''), /, record view: 16 element\(s\), 7 finding\(s\), 4 patch\(es\) in 3 change set\(s\), 5 group lane\(s\), 5 layer lane\(s\), outcomes by declared impact, layout faults 0/);
  assert.match(html, /<title>Parcel record — record<\/title>/);
  assert.equal(sinks, 0, b.err.join(''));
  assert.match(b.out.join(''), /outcomes by sink rule, layout faults 0/);
  assert.ok(readFileSync(join(dir, 's.html'), 'utf8').includes('Parcel intake service'));
});

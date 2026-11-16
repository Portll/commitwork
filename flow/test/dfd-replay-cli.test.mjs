// commitwork dfd --view replay (flow/dfd-cli.mjs): the flag, what it refuses, and the page it writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, main } from '../dfd-cli.mjs';
import { MODEL } from '../../lib/test/fixtures/dfd-replay-model.mjs';

const io = () => { const out = []; const err = []; return { out, err, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } }; };

test('replay is a view, and it takes no --collapse', () => {
  // arrange
  const cases = [['--from', 'x.json', '--view', 'replay'], ['--from', 'x.json', '--view', 'replay', '--collapse', 'g']];
  // act
  const got = cases.map((argv) => parseArgs(argv));
  // assert
  assert.equal(got[0].error, undefined);
  assert.equal(got[0].opts.view, 'replay');
  assert.match(got[1].error, /--view replay opens and closes groups on the page, so it takes no --collapse/);
});

test('--view replay writes its page whatever --max says, with the title given and the counts on stdout', async () => {
  // arrange
  const dir = mkdtempSync(join(tmpdir(), 'flow-dfd-replay-'));
  writeFileSync(join(dir, 'm.json'), JSON.stringify(MODEL()));
  const a = io();
  const b = io();
  // act
  const code = await main(['--from', join(dir, 'm.json'), '--view', 'replay', '--max', '2', '--title', 'Parcel replay', '--out', join(dir, 'r.html')], a);
  const html = readFileSync(join(dir, 'r.html'), 'utf8');
  const untitled = await main(['--from', join(dir, 'm.json'), '--view', 'replay', '--out', join(dir, 'u.html')], b);
  // assert
  assert.equal(code, 0, a.err.join(''));
  assert.match(a.out.join(''), /replay view: 4 change set\(s\), 7 issue\(s\), 13 drawable element\(s\), 6 file\(s\)/);
  assert.ok(html.includes('Parcel replay'));
  assert.equal(untitled, 0, b.err.join(''));
  assert.ok(readFileSync(join(dir, 'u.html'), 'utf8').includes('Parcel intake service'));
});

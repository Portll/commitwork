// commitwork dfd --view story (flow/dfd-cli.mjs): the flag, what it refuses, and the page it writes;
// and that the plain names and caveats the view shows are admitted by the schema's validator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDfd } from '../../lib/dfd.mjs';
import { VIEWS, parseArgs, main } from '../dfd-cli.mjs';
import { STORY } from '../../lib/test/fixtures/dfd-story-model.mjs';

const io = () => { const out = []; const err = []; return { out, err, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) } }; };
/** The fixture as a document a producer could emit: the two things it carries to test the view's tolerance are dropped. */
const valid = () => { const m = STORY(); m.flows = m.flows.filter((f) => f.from !== 'ghost' && f.from !== f.to); m.findings = m.findings.filter((f) => f.id !== 'W4' && f.id !== 'W5'); return m; };

test('story is a view, and it takes no --collapse', () => {
  // arrange
  const cases = [['--from', 'x.json', '--view', 'story'], ['--from', 'x.json', '--view', 'story', '--collapse', 'g'], ['--from', 'x.json', '--view', 'tale']];
  // act
  const got = cases.map((argv) => parseArgs(argv));
  // assert
  assert.deepEqual(VIEWS, ['classic', 'paths', 'map', 'story', 'replay', 'record']);
  assert.equal(got[0].error, undefined);
  assert.match(got[1].error, /--view story chooses what to draw from the findings, so it takes no --collapse/);
  assert.match(got[2].error, /--view takes one of classic, paths, map, story, replay/);
});

test('a document with plain names and a caveat is valid, and --view story writes its page whatever --max says', async () => {
  // arrange
  const dir = mkdtempSync(join(tmpdir(), 'flow-dfd-story-'));
  const model = valid();
  writeFileSync(join(dir, 'm.json'), JSON.stringify(model));
  const a = io();
  // act
  const checked = validateDfd(model);
  const code = await main(['--from', join(dir, 'm.json'), '--view', 'story', '--fonts', 'none', '--max', '2', '--out', join(dir, 's.html')], a);
  const html = readFileSync(join(dir, 's.html'), 'utf8');
  // assert
  assert.deepEqual(checked.errors, []);
  assert.equal(code, 0, a.err.join(''));
  assert.match(a.out.join(''), /story view: 10 box\(es\) drawn, 0 left out, 4 finding\(s\), 6 stage\(s\)/);
  assert.match(html, /<title>toy — story<\/title>/);
});

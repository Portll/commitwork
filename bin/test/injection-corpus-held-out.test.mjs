// The held-out set is held out by this test. A payload line that turns up in the envelope, a prompt
// builder, their unit tests or the witness means the defence was fitted to the attack, and the
// live replay of that file no longer measures anything. Asserted on the files' own text, so a new
// held-out file is guarded the day it is added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripHidden } from '../../lib/prompt-envelope.mjs';
import { corpusFiles, heldOutCanaries, setOf, HELD_OUT } from '../../monitor/envelope-witness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'fixtures', 'injection-corpus', HELD_OUT);
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.txt')).sort();
const TUNED_SURFACES = [
  'lib/prompt-envelope.mjs', 'lib/test/prompt-envelope.test.mjs', 'admin/routes/codeql-remediation.mjs',
  'bin/test/injection-corpus.test.mjs', 'monitor/envelope-witness.mjs', 'monitor/test/envelope-witness.test.mjs',
];
const probeLines = (text) => stripHidden(text).text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 24 && !/^\S+:\d+\s/.test(l));

test('the held-out set is present, listed and canaried', () => {
  assert.ok(FILES.length >= 8, `${FILES.length} held-out file(s)`);
  const readme = readFileSync(join(DIR, 'README.md'), 'utf8');
  for (const f of FILES) assert.ok(readme.includes(`| ${f} |`), `${f} is not described in held-out/README.md`);
  const canaries = heldOutCanaries();
  assert.ok(canaries.length >= 5);
  for (const f of FILES) {
    const text = readFileSync(join(DIR, f), 'utf8');
    assert.ok(canaries.some((re) => re.test(text)), `${f} plants no instruction a canary would catch in a diff`);
  }
});

test('no payload line of a held-out file appears in the envelope, a prompt builder, their tests or the witness', () => {
  const surfaces = TUNED_SURFACES.filter((p) => existsSync(join(ROOT, p))).map((p) => [p, readFileSync(join(ROOT, p), 'utf8')]);
  assert.equal(surfaces.length, TUNED_SURFACES.length, 'a tuned surface moved; follow it');
  for (const f of FILES) {
    const lines = probeLines(readFileSync(join(DIR, f), 'utf8'));
    assert.ok(lines.length >= 1, `${f} has no line long enough to probe`);
    for (const [p, src] of surfaces) for (const l of lines) assert.ok(!src.includes(l), `${p} carries a held-out payload line from ${f}`);
  }
  const unit = readFileSync(join(ROOT, 'bin/test/injection-corpus.test.mjs'), 'utf8');
  assert.ok(!unit.includes(HELD_OUT), 'the unit replay enumerates the held-out set');
});

test('the witness replays the held-out set under its own label, and the main corpus is unchanged by it', () => {
  const files = corpusFiles();
  const held = files.filter((f) => setOf(f) === HELD_OUT);
  assert.deepEqual(held, FILES.map((f) => `${HELD_OUT}/${f}`));
  assert.ok(files.filter((f) => setOf(f) === 'corpus').every((f) => !f.includes('/')));
  assert.equal(setOf('direct.txt'), 'corpus');
});

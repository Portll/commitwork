// Summary sentence, usage lines and option lines from a script header (bin/reference.mjs commandDoc).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandDoc } from '../reference.mjs';

test('Blank comment lines between summary and usage are skipped so usage and options are still collected.', () => {
  const src = '// A tool that does things.\n//\n// usage: foo <arg>\n//   --help  show help\n';
  assert.deepEqual(commandDoc(src, 'foo.mjs'), {
    summary: 'A tool that does things.',
    usage: ['foo <arg>'],
    options: ['--help  show help'],
  });
});

test('Empty source yields a null summary and empty usage and options.', () => {
  assert.deepEqual(commandDoc('', 'foo.mjs'), { summary: null, usage: [], options: [] });
});

test('Source without a header comment yields a null summary and empty lists.', () => {
  assert.deepEqual(commandDoc('const x = 1;\n', 'foo.mjs'), { summary: null, usage: [], options: [] });
});

test('Only the first sentence of the summary is kept.', () => {
  const src = '// A tool. Second sentence.\n// usage: foo <arg>\n';
  assert.deepEqual(commandDoc(src, 'foo.mjs'), { summary: 'A tool.', usage: ['foo <arg>'], options: [] });
});

test('Multiple usage lines and option lines are all collected in order.', () => {
  const src = '// usage: foo <arg>\n// usage: foo --flag\n//   -v, --verbose  more output\n';
  assert.deepEqual(commandDoc(src, 'foo.mjs'), {
    summary: null,
    usage: ['foo <arg>', 'foo --flag'],
    options: ['-v, --verbose  more output'],
  });
});

test('A summary longer than 220 characters is cut with an ellipsis.', () => {
  const w = 'word '.repeat(60).trim();
  const r = commandDoc(`// ${w}.\n`, 'foo.mjs');
  assert.deepEqual(r, { summary: `${`${w}.`.slice(0, 219).trimEnd()}\u2026`, usage: [], options: [] });
});

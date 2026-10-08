// The unknown-command hint in bin/commitwork.mjs main() names every subcommand main() dispatches.
// Read from source: running the CLI would reach ensureFirstRunSetup() before the dispatch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../commitwork.mjs', import.meta.url)), 'utf8');

test('the unknown-command hint lists every dispatched subcommand', () => {
  const body = SRC.slice(SRC.indexOf('async function main()'));
  const hint = body.match(/unknown command: \$\{cmd\} \(try: ([^)]+)\)/);
  assert.ok(hint, 'hint not found in main()');
  const listed = new Set(hint[1].split(',').map((s) => s.trim()));
  const dispatched = new Set([
    ...[...body.matchAll(/cmd === '([a-z][a-z-]*)'/g)].map((m) => m[1]),
    ...[...body.matchAll(/case '([a-z][a-z-]*)':/g)].map((m) => m[1]),
  ]);
  assert.ok(dispatched.size >= 8, `only ${dispatched.size} subcommands found; the extractor no longer reads main()`);
  const missing = [...dispatched].filter((c) => !listed.has(c));
  assert.deepEqual(missing, []);
});

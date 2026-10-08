// admin — where a FAILED project resolution points: reportsFor() must yield the UNRESOLVED void,
// never another area's directory (plausible numbers about the wrong subject).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reportsFor, UNRESOLVED } from '../lib/core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');

describe('a failed resolution never points at another area', () => {
  test('no project yields the void, not a named area', () => {
    const d = reportsFor(undefined);
    assert.equal(d, UNRESOLVED);
    assert.doesNotMatch(d, /client-a/i, 'the void must not be one customer\'s report directory');
  });

  test('the void resolves NOWHERE — absence renders as absence', () => {
    // If this directory ever exists, something is writing into a resolution failure.
    assert.equal(existsSync(UNRESOLVED), false,
      'reports/__unresolved__ must never be created — a void that exists is a void that can hold data');
  });

  test('an unreadable registry is a void, not a substitution', () => {
    // The throw path, in a child so the env override is real — the registry is read at call time.
    const out = execFileSyncQuiet(['-e', `
      import(${JSON.stringify(pathToFileURL(join(CW, 'admin/lib/core.mjs')).href)}).then(m => {
        process.stdout.write(String(m.reportsFor('client-a')));
      });`], { CW_REGISTRY: '/nonexistent/nope.json' });
    assert.match(out, /__unresolved__/, 'a broken registry must not answer with a real area');
    assert.doesNotMatch(out, /client-a-monorepo/);
  });

  test('a known project that HAS an area still resolves to its own dir', () => {
    // The fix must not turn every lookup into a void — that would trade a wrong answer for no answer.
    const d = reportsFor('commitwork');
    assert.notEqual(d, UNRESOLVED, 'a resolvable project must still get its own directory');
    // Either separator: this is an OS-native path from resolve()/join(), so on Windows it is
    // `…\reports\commitwork`. Asserting `reports/` matched the platform rather than the property.
    assert.match(d, /reports[/\\]/);
  });

  test('neither file carries the hardcoded fallback any more', () => {
    for (const f of ['admin/serve.mjs', 'admin/lib/core.mjs']) {
      const src = readFileSync(join(CW, f), 'utf8');
      // Skip comment lines — the comment above UNRESOLVED quotes the removed literal on purpose.
      const bad = src.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .filter((l) => /join\(\s*CW\s*,\s*'reports'\s*,\s*'client-a-monorepo'\s*\)/.test(l));
      assert.deepEqual(bad, [], `${f}: a literal report dir here is the defect returning`);
    }
  });
});

function execFileSyncQuiet(args, env) {
  try {
    return execFileSync('node', args, { cwd: CW, encoding: 'utf8', timeout: 30_000, env: { ...process.env, ...env } });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

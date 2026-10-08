// admin/lib/jobs.mjs jobArgv — the argv each panel job spawns. bin/commitwork.mjs's parseArgs
// files an unrecognised flag as a positional and `scan` ignores positionals, so a flag the CLI
// does not parse is dropped without a word: the scan-path job passed `--auto-install` for weeks
// after the parser lost it, and still claimed to install. Each flag here must be one the target
// CLI's own parser names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { initJobs, jobArgv } from '../lib/jobs.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-job-argv-'));
process.env.CW_HEALTH_RUNS_STORE = join(TMP, 'health-runs.json');
process.env.CW_SWEEP_LIVE_LOG = join(TMP, 'sweep-latest.log');
initJobs({
  CW: REPO, registry: () => ({ areas: [] }), sessionStorePath: () => join(TMP, 'sessions.json'),
  projectSlug: (s) => s, primaryArea: () => null,
});

// The body of one named function, from its declaration to the first column-0 closing brace.
function functionBody(file, name) {
  const src = readFileSync(join(REPO, file), 'utf8');
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- test helper building a pattern from a literal name or class taken from the test itself
  const at = src.search(new RegExp(`function ${name}\\(`));
  assert.ok(at >= 0, `${file} no longer declares ${name}() — this test reads its flags from there`);
  return src.slice(at, src.indexOf('\n}\n', at));
}
const flagsOf = (argv) => argv.filter((a) => typeof a === 'string' && a.startsWith('--'));

test('scan-path spawns a brief of the one path into its private output, with no install flag', () => {
  const argv = jobArgv('scan-path', null, { path: '/tmp/some repos', out: '/private/out/2026-09-29T01-02-03' });
  assert.deepEqual(argv, ['node', join(REPO, 'bin/commitwork.mjs'), 'brief', '--root', '/tmp/some repos', '--out', '/private/out/2026-09-29T01-02-03']);
  assert.equal(jobArgv('scan-path', null, { path: '/tmp/some repos' }), null, 'without --out the CLI writes into <checkout>/reports');
});

test('scan-path for the whole machine passes --pc and no path; without --out it has no argv either', () => {
  const argv = jobArgv('scan-path', null, { pc: true, out: '/private/out/2026-09-29T01-02-03' });
  assert.deepEqual(argv, ['node', join(REPO, 'bin/commitwork.mjs'), 'brief', '--pc', '--out', '/private/out/2026-09-29T01-02-03']);
  assert.equal(jobArgv('scan-path', null, { pc: true }), null);
  assert.equal(jobArgv('scan-path', null, { out: '/o' }), null, 'neither a path nor --pc: nothing to scan');
});

test('every flag the scan-path job passes is one `commitwork brief` parses', () => {
  const parser = functionBody('bin/commitwork.mjs', 'parseArgs');
  for (const opts of [{ path: '/x', out: '/o' }, { pc: true, out: '/o' }]) {
    for (const f of flagsOf(jobArgv('scan-path', null, opts))) {
      assert.ok(parser.includes(`'${f}'`), `bin/commitwork.mjs parseArgs does not parse ${f}; it would be dropped silently`);
    }
  }
});

test('every flag the install-tools job passes is one `commitwork setup` parses', () => {
  const parser = functionBody('bin/setup.mjs', 'parseSetupArgs');
  const argv = jobArgv('install-tools', null, { only: ['gitleaks', 'semgrep'] });
  assert.deepEqual(argv.slice(2), ['setup', '--yes', '--only', 'gitleaks,semgrep']);
  for (const f of flagsOf(argv)) assert.ok(parser.includes(`'${f}'`), `bin/setup.mjs parseSetupArgs does not parse ${f}`);
});

test('an unknown kind has no argv', () => {
  assert.equal(jobArgv('frobnicate', 'p', {}), null);
});

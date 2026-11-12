// `commitwork dfd` is flow/dfd-cli.mjs behind the CLI: same help, same exit codes, and no report
// directory or first-run setup on the way (it installs and runs no scanner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HELP, EXIT } from '../../flow/dfd-cli.mjs';

const CLI = fileURLToPath(new URL('../commitwork.mjs', import.meta.url));
const run = (...argv) => {
  const env = { ...process.env };
  delete env.CW_REPORT_DIR;
  return spawnSync(process.execPath, [CLI, 'dfd', ...argv], { encoding: 'utf8', env, stdin: 'ignore' });
};

test('commitwork dfd --help prints the command\'s own help and exits 0, with no report-directory notice', () => {
  // arrange
  const argv = ['--help'];

  // act
  const r = run(...argv);

  // assert
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, HELP);
  assert.doesNotMatch(r.stderr, /CW_REPORT_DIR/);
});

test('commitwork dfd exits with the command\'s codes: usage 2, a non-checkout 21', () => {
  // arrange
  const cases = [['--bogus'], ['--repo', '/']];

  // act
  const got = cases.map((a) => run(...a));

  // assert
  assert.deepEqual(got.map((r) => r.status), [EXIT.USAGE, EXIT.INPUT]);
  assert.match(got[0].stderr, /^dfd: unknown argument --bogus/);
  assert.match(got[1].stderr, /is not a git checkout/);
});

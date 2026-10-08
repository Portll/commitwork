// A dry-run must never spawn `act`: the trust gate deliberately exempts `run --dry-run`, so
// honouring --act there would execute an untrusted manifest's workflow — an RCE. Guards the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'commitwork.mjs');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-act-dry-'));
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
  writeFileSync(
    join(dir, '.github', 'workflows', 'x.yml'),
    'name: x\non: [push]\njobs: { j: { runs-on: ubuntu-latest, steps: [{ run: "echo SHOULD_NOT_RUN" }] } }\n',
  );
  writeFileSync(
    join(dir, 'commitwork.json'),
    JSON.stringify({
      repo: '.',
      checks: [
        { id: 'act-check', workflow: '.github/workflows/x.yml', local: ['echo local-cmd'], act: { enabled: true, job: 'j' } },
      ],
    }),
  );
  return dir;
}

test('run --dry-run --act on an untrusted repo-local manifest prints act but executes nothing (no RCE)', () => {
  const dir = fixture();
  try {
    const r = spawnSync('node', [CLI, 'run', 'act-check', '--dry-run', '--act'], { cwd: dir, encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    // Trust gate exempts a dry-run, so it must NOT die; and act must not have been required/run.
    assert.equal(r.status, 0, `expected exit 0 (dry-run is trust-exempt, must not die/execute); got ${r.status}\n${out}`);
    assert.match(out, /\$ act -W \.github\/workflows\/x\.yml/, 'should print the intended act invocation');
    assert.match(out, /skipped.*dry-run/i, 'the act check should be reported skipped as a dry-run');
    assert.doesNotMatch(out, /SHOULD_NOT_RUN/, 'act must NOT have executed the untrusted workflow');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

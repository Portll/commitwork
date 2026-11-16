// Keeps the sast-opengrep loop-taint note true: it re-measures both engines on synthetic loop chains.
// Shells out to opengrep and semgrep, and is skipped by name and with its reason when either is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MANIFEST = () => process.env.CW_BASELINE_MANIFEST || new URL('../../manifests/security-baseline.json', import.meta.url);
const present = (bin) => spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 60_000 }).status === 0;

const RULE = `rules:
  - id: get-to-echo
    languages: [php]
    severity: WARNING
    message: request input reaches echo
    mode: taint
    pattern-sources:
      - pattern: $_GET[...]
    pattern-sinks:
      - pattern: echo $X;
`;

/** chain-N.php moves taint one variable per loop pass, so its sink needs N+1 passes. */
export function chain(n) {
  const init = Array.from({ length: n + 1 }, (_, i) => `  $a${i} = "";`);
  const body = Array.from({ length: n }, (_, k) => `    $a${n - k} = $a${n - k - 1};`);
  return ['<?php', `function chain_${n}($c) {`, ...init, '  while ($c) {', ...body, '    $a0 = $_GET["x"];', '  }', `  echo $a${n};`, '}', ''].join('\n');
}

/** flat-N.php is the same chain with no loop: the control that the rule fires on each engine. */
export function flat(n) {
  const body = Array.from({ length: n }, (_, k) => `  $a${k + 1} = $a${k};`);
  return ['<?php', `function flat_${n}() {`, '  $a0 = $_GET["x"];', ...body, `  echo $a${n};`, '}', ''].join('\n');
}

const CASES = { 'chain-2.php': chain(2), 'chain-3.php': chain(3), 'chain-8.php': chain(8), 'flat-8.php': flat(8) };

function scan(bin, dir) {
  const out = join(dir, `${bin}.json`);
  const extra = bin === 'semgrep' ? ['--metrics=off'] : [];
  const r = spawnSync(bin, ['scan', ...extra, '--config', join(dir, 'rule.yaml'), '--json-output', out, '-j', '1', '--quiet', join(dir, 'in')],
    { cwd: dir, encoding: 'utf8', timeout: 300_000 });
  assert.equal(r.status, 0, `${bin} exited ${r.status}: ${(r.stderr || '').slice(-400)}`);
  const doc = JSON.parse(readFileSync(out, 'utf8'));
  const found = [...new Set(doc.results.map((x) => x.path.split('/').pop()))].sort();
  return { found, errors: doc.errors.length, fixpointTimeouts: doc.time && doc.time.fixpoint_timeouts };
}

test('opengrep drops loop-carried taint after four passes and says nothing; semgrep finds it', { timeout: 600_000 }, (t) => {
  const missing = ['opengrep', 'semgrep'].filter((b) => !present(b));
  if (missing.length) return t.skip(`SKIPPED (not a silent pass): ${missing.join(' and ')} not installed, so the loop-taint note was NOT re-measured`);
  const dir = mkdtempSync(join(tmpdir(), 'cw-loop-taint-'));
  try {
    writeFileSync(join(dir, 'rule.yaml'), RULE);
    spawnSync('mkdir', [join(dir, 'in')]);
    for (const [name, src] of Object.entries(CASES)) writeFileSync(join(dir, 'in', name), src);

    const sg = scan('semgrep', dir);
    assert.deepEqual(sg.fixpointTimeouts, [], `semgrep recorded fixpoint timeouts on the fixture, so its result here is not a measurement: ${JSON.stringify(sg.fixpointTimeouts)}`);
    assert.deepEqual(sg.found, ['chain-2.php', 'chain-3.php', 'chain-8.php', 'flat-8.php'], 'semgrep no longer finds every chain: re-measure and correct the sast-opengrep note');

    const og = scan('opengrep', dir);
    assert.ok(og.found.includes('flat-8.php') && og.found.includes('chain-2.php'), `opengrep misses a control, so the rule or the engine broke, not the loop: ${og.found}`);
    assert.deepEqual(og.found, ['chain-2.php', 'flat-8.php'], 'opengrep now finds chains past depth 2: re-measure and correct the sast-opengrep note');
    assert.equal(og.errors, 0, 'opengrep now reports the dropped taint as an error: the note says it reports nothing');
    assert.equal(og.fixpointTimeouts, undefined, 'opengrep now writes time.fixpoint_timeouts: bin/semgrep-retry.mjs can measure it, and the note says it cannot');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the sast-opengrep check carries the loop-taint note this file measures', () => {
  const check = JSON.parse(readFileSync(MANIFEST(), 'utf8')).checks.find((c) => c.id === 'sast-opengrep');
  assert.ok(check, 'sast-opengrep is not in the manifest');
  assert.match(check.notes || '', /LOOP-CARRIED TAINT/, 'sast-opengrep has no loop-carried taint note');
  assert.match(check.notes || '', /monitor\/test\/opengrep-loop-taint\.test\.mjs/, 'the note does not name the test that keeps it true');
  assert.match(check.description, /LOOP-CARRIED TAINT EXCEPTED/, 'the description still claims parity without the exception');
});

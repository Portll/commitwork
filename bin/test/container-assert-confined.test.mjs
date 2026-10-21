// node --test bin/test/container-assert-confined.test.mjs
//
// container/assert-confined.mjs, the verdict the container CI job reaches on its scan: a lane that ran
// unconfined fails, a refused lane does not, and a scan where too few lanes ran is not a pass.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { confinement, notRunCause, EXIT } from '../../container/assert-confined.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'container', 'assert-confined.mjs');
const dir = mkdtempSync(join(tmpdir(), 'cw-assert-confined-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const scan = (cells) => ({ version: 1, baseline: 'x', repos: [{ repo: '/repo', slug: 'repo', cells }] });
const run = (doc, ...args) => {
  const f = join(dir, `${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, typeof doc === 'string' ? doc : JSON.stringify(doc));
  const r = spawnSync(process.execPath, [SCRIPT, f, ...args], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const confined = {
  gitleaks: { sev: 'ok', isolation: 'full' },
  semgrep: { sev: 'med', isolation: 'fs-only' },
  'deps-osv': { sev: 'noscan', isolation: 'none', summary: 'CW_SANDBOX=require and the host sandbox is unavailable' },
  a11y: { sev: 'skip', summary: 'n/a' },
};

test('every lane that ran was confined: a pass, and the refused lane is not counted as a breach', () => {
  const r = run(scan(confined));
  assert.equal(r.status, EXIT.OK, r.out);
  assert.match(r.out, /2 lane\(s\) ran \{"full":1,"fs-only":1\}; 2 did not run/);
});

test('a lane that ran with isolation none, or with none recorded, fails', () => {
  const none = run(scan({ ...confined, ruff: { sev: 'low', isolation: 'none', isolationReason: 'host sandbox unavailable' } }));
  assert.equal(none.status, EXIT.UNCONFINED, none.out);
  assert.match(none.out, /UNCONFINED repo ruff: isolation none/);
  const missing = run(scan({ ...confined, ruff: { sev: 'ok' } }));
  assert.equal(missing.status, EXIT.UNCONFINED, missing.out);
  assert.match(missing.out, /UNCONFINED repo ruff: isolation not recorded/);
});

test('a scan where nothing, or too little, ran is not a pass', () => {
  const nothing = run(scan({ 'deps-osv': confined['deps-osv'], a11y: confined.a11y }));
  assert.equal(nothing.status, EXIT.TOO_FEW, nothing.out);
  assert.equal(run(scan(confined), '--min', '3').status, EXIT.TOO_FEW);
  assert.equal(run(scan(confined), '--min', '2').status, EXIT.OK);
});

test('an unreadable or empty scan.json fails closed', () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT, join(dir, 'absent.json')]).status, EXIT.UNREADABLE);
  assert.equal(run('{ "repos": [').status, EXIT.UNREADABLE);
  assert.equal(run({ version: 1, repos: [] }).status, EXIT.UNREADABLE);
  assert.throws(() => confinement({}), /no repository/);
});

test('usage errors are exit 2', () => {
  assert.equal(spawnSync(process.execPath, [SCRIPT]).status, EXIT.USAGE);
  assert.equal(run(scan(confined), '--min', 'many').status, EXIT.USAGE);
  assert.equal(run(scan(confined), '--bogus').status, EXIT.USAGE);
});

// A shortfall names why each lane did not run, from the scan.json assert-confined already has open,
// rather than a bare count. These pin the classifier, and above all that the two confinement
// causes stay distinguishable from thin coverage: a trigger miss is not a defect, a refused bind
// is.
describe('a shortfall names why the lanes did not run', () => {
  test('the sandbox causes are distinct from coverage, and trigger misses collapse to one bucket', () => {
    const cause = (summary) => notRunCause({ summary });
    assert.equal(cause("host sandbox profile could not be applied, so the lane did not run: bwrap: Can't find source path /home/node/Library/Caches/ruff: No such file or directory"),
      'bwrap refused a bind whose source is absent',
      'the missing-bind case must be named: it is a confinement regression wearing a coverage number');
    assert.equal(cause('host sandbox profile could not be applied, so the lane did not run: something else'),
      'the sandbox profile could not be applied');
    assert.equal(cause('tool:betterleaks (not on PATH)'), 'a tool it requires is not installed');
    assert.equal(cause('no findings and no completion receipt in trufflehog.log — the scan did not finish'),
      'the tool started and did not finish');
    // The long tail. Forty-three single-item groups buried the four that mattered.
    for (const s of ['none of Cargo.lock present', 'no .go sources found', 'none of pom.xml/build.gradle present']) {
      assert.equal(cause(s), 'its trigger did not match this repository', s);
    }
    assert.equal(cause(''), 'no reason recorded', 'a lane that will not say why is not an absent lane');
  });

  test('confinement() groups the not-run causes, so the count is never the only output', () => {
    const doc = { repos: [{ slug: 'r', cells: {
      ran1: { sev: 'ok', isolation: 'full' },
      bind1: { sev: 'noscan', summary: "bwrap: Can't find source path /x: No such file or directory" },
      bind2: { sev: 'noscan', summary: "bwrap: Can't find source path /y: No such file or directory" },
      tool1: { sev: 'noscan', summary: 'tool:syft (not on PATH)' },
      trig1: { sev: 'skip', summary: 'none of Cargo.lock present' },
    } }] };
    const r = confinement(doc);
    assert.equal(r.ran.length, 1);
    assert.equal(r.notRun, 4);
    const byCause = Object.fromEntries([...r.causes].map(([k, v]) => [k, v.sort()]));
    assert.deepEqual(byCause['bwrap refused a bind whose source is absent'], ['bind1', 'bind2'],
      'the refused binds must be grouped together and named');
    assert.deepEqual(byCause['a tool it requires is not installed'], ['tool1']);
    assert.deepEqual(byCause['its trigger did not match this repository'], ['trig1']);
    assert.equal([...r.causes].reduce((n, [, v]) => n + v.length, 0), r.notRun,
      'every not-run lane is accounted for in exactly one cause, or the breakdown understates');
  });
});

// C2 must be able to FAIL, must be able to say it failed, and must never say "clean" when it means
// "I did not run". The named-import case is here because it is the one that was silently broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observe, readTrace, record, summarise } from '../runtime.mjs';

function fixtureRepo() {
  const d = mkdtempSync(join(tmpdir(), 'flow-rt-'));
  mkdirSync(join(d, 'bin'), { recursive: true });
  mkdirSync(join(d, 'reports'), { recursive: true });
  writeFileSync(join(d, 'reports', 'input.json'), '{"a":1}\n');
  return d;
}

test('THE NAMED-IMPORT CASE — the form an --import hook silently misses', () => {
  // Measured 2026-09-02: `node --import hook.mjs` where the hook does `import fs from "node:fs"`
  // intercepts the default-namespace and dynamic forms and MISSES `import { readFileSync }` and
  // `import * as fs`, because importing the builtin freezes the ESM facade's named bindings against
  // the original functions. That form is the commonest in this repo, so the trace would have been
  // near-empty — and an empty trace reads as a clean run.
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'named.mjs'),
      'import { readFileSync } from "node:fs";\n'
      + 'import * as fs3 from "node:fs";\n'
      + 'readFileSync("reports/input.json", "utf8");\n'
      + 'fs3.readFileSync("reports/input.json", "utf8");\n');
    const r = observe(['bin/named.mjs'], { root: d });
    assert.equal(r.state, 'usable');
    assert.ok(r.observations.some((o) => o.from === 'bin/named.mjs' && o.to === 'reports/input.json' && o.kind === 'reads'),
      'a NAMED import of readFileSync must be observed, or C2 is a hole shaped like a witness');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('writes and spawns are observed too, and attributed to the calling module', () => {
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'w.mjs'),
      'import { writeFileSync } from "node:fs";\n'
      + 'import { spawnSync } from "node:child_process";\n'
      + 'writeFileSync("reports/out.json", "{}\\n");\n'
      + 'spawnSync("/bin/echo", ["hi"]);\n');
    const r = observe(['bin/w.mjs'], { root: d });
    assert.ok(r.observations.some((o) => o.kind === 'writes' && o.to === 'reports/out.json' && o.from === 'bin/w.mjs'));
    assert.ok(r.observations.some((o) => o.kind === 'spawns' && o.to === '/bin/echo'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('attribution reaches the module that made the call, not the entry point', () => {
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'deep.mjs'),
      'import { readFileSync } from "node:fs";\nexport const go = () => readFileSync("reports/input.json", "utf8");\n');
    writeFileSync(join(d, 'bin', 'entry.mjs'), 'import { go } from "./deep.mjs";\ngo();\n');
    const r = observe(['bin/entry.mjs'], { root: d });
    assert.ok(r.observations.some((o) => o.from === 'bin/deep.mjs' && o.to === 'reports/input.json'),
      'the stack, not the entry point, decides the actor');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('NEGATIVE CONTROL — an unrun hook is UNUSABLE, never an edgeless clean run', () => {
  const d = mkdtempSync(join(tmpdir(), 'flow-rt-'));
  try {
    const t = join(d, 'trace.jsonl');
    assert.equal(readTrace(t).state, 'absent', 'a missing trace is absent, not clean');

    writeFileSync(t, '');
    assert.equal(readTrace(t).state, 'unusable', 'an empty trace means the preload never ran');

    // Rows present, installed row absent: the shape a truncated or hand-made trace has.
    writeFileSync(t, `${JSON.stringify({ t: 'read', path: 'a', actor: 'b' })}\n`);
    assert.equal(readTrace(t).state, 'unusable');

    // Installed, but the hook could not witness its own read — patched by assignment only.
    writeFileSync(t, `${JSON.stringify({ t: 'installed', selfWitness: false })}\n`);
    const r = readTrace(t);
    assert.equal(r.state, 'unusable');
    assert.match(r.reason, /inert/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('an unusable trace summarises to a REFUSAL, not to zero observations', () => {
  const s = summarise({ state: 'unusable', rows: [], reason: 'preload never ran' });
  assert.equal(s.state, 'unusable');
  assert.deepEqual(s.observations, []);
  assert.deepEqual(s.coverage, []);
  assert.ok(s.reason, 'the caller must be able to tell this apart from a run that did nothing');
});

test('the hook proves it intercepted its own probe read', () => {
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'noop.mjs'), 'export const a = 1;\n');
    const run = record(['bin/noop.mjs'], { root: d });
    const t = readTrace(run.trace);
    assert.equal(t.state, 'usable');
    assert.equal(t.rows.find((r) => r.t === 'installed').selfWitness, true,
      'selfWitness is the difference between a patch that is assigned and a patch that is on the path');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('coverage records modules ENTERED, which is what bounds the reconciliation', () => {
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'ran.mjs'), 'import { readFileSync } from "node:fs";\nreadFileSync("reports/input.json", "utf8");\n');
    writeFileSync(join(d, 'bin', 'never.mjs'), 'export const x = 1;\n');
    const r = observe(['bin/ran.mjs'], { root: d });
    assert.ok(r.coverage.includes('bin/ran.mjs'));
    assert.ok(!r.coverage.includes('bin/never.mjs'), 'a module never loaded is outside the coverage set');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

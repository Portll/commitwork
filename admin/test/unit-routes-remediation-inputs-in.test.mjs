// Per-area input and output presence for the remediation tab (admin/routes/remediation.mjs inputsIn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputsIn } from '../routes/remediation.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mk = () => mkdtempSync(join(tmpdir(), 'inputsIn-'));
const planMd = [
  '## Critical / High / Medium \u2014 2 packages, 3 findings',
  '## Low severity \u2014 1 package, 1 finding',
  '**Headline:** 1 critical \u00b7 1 high \u00b7 1 medium \u00b7 1 low \u00b7 **1 on CISA KEV**',
  'Generated 2024-01-01T00:00:00Z from rollup.json',
  '## \ud83d\udea8 KEV',
  '| `pkg` | x |',
  '| `pkg2` | y |',
].join('\n');

test('returns absent states when the area directory is empty', () => {
  const dir = mk();
  try {
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.rollup.state, 'absent');
    assert.equal(r.inputs.plan.state, 'absent');
    assert.equal(r.inputs.batch.state, 'absent');
    assert.equal(r.inputs.ledger.state, 'absent');
    assert.equal(r.inputs.codeqlFleet.state, 'absent');
    assert.equal(r.outputs.triage.state, 'absent');
    assert.equal(r.outputs.codeqlJobs.state, 'absent');
    assert.equal(r.scanners, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('parses a valid rollup with a source that resolves under root', () => {
  const dir = mk();
  try {
    const batch = join(dir, 'reports', 'sweep-1-area');
    mkdirSync(batch, { recursive: true });
    writeFileSync(join(dir, 'rollup.json'), JSON.stringify({ generated: 'g1', source: 'reports/sweep-1-area', scanners: { grep: 1 } }));
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.rollup.state, 'ok');
    assert.equal(r.inputs.rollup.generated, 'g1');
    assert.equal(r.inputs.batch.state, 'ok');
    assert.equal(r.inputs.batch.source, 'reports/sweep-1-area');
    assert.deepEqual(r.scanners, { grep: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('marks batch absent when the named source is outside the reports root', () => {
  const dir = mk();
  try {
    writeFileSync(join(dir, 'rollup.json'), JSON.stringify({ source: '/etc/passwd' }));
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.batch.state, 'absent');
    assert.match(r.inputs.batch.why, /not under the reports root/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('marks batch absent when the named source path does not exist', () => {
  const dir = mk();
  try {
    writeFileSync(join(dir, 'rollup.json'), JSON.stringify({ source: 'reports/missing' }));
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.batch.state, 'absent');
    assert.match(r.inputs.batch.why, /not under the reports root/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('marks batch absent when rollup has no source field', () => {
  const dir = mk();
  try {
    writeFileSync(join(dir, 'rollup.json'), JSON.stringify({ generated: 'g' }));
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.batch.state, 'absent');
    assert.equal(r.inputs.batch.why, 'rollup.json names no sweep batch');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('marks rollup unreadable when the file is not a JSON object', () => {
  const dir = mk();
  try {
    writeFileSync(join(dir, 'rollup.json'), '42');
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.rollup.state, 'unreadable');
    assert.equal(r.inputs.rollup.why, 'rollup.json is not a JSON object');
    assert.equal(r.inputs.batch.state, 'unknown');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('parses the plan summary from REMEDIATION.md headings', () => {
  const dir = mk();
  try {
    writeFileSync(join(dir, 'REMEDIATION.md'), planMd);
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.plan.state, 'ok');
    assert.equal(r.inputs.plan.summary.parsed, true);
    assert.equal(r.inputs.plan.summary.packages, 3);
    assert.equal(r.inputs.plan.summary.findings, 4);
    assert.equal(r.inputs.plan.summary.kevPackages, 2);
    assert.equal(r.inputs.plan.summary.generated, '2024-01-01T00:00:00Z');
    assert.deepEqual(r.inputs.plan.summary.headline, { crit: 1, high: 1, med: 1, low: 1, kev: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('marks plan unreadable when the file lacks the expected section headings', () => {
  const dir = mk();
  try {
    writeFileSync(join(dir, 'REMEDIATION.md'), 'no headings here');
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.plan.state, 'ok');
    assert.equal(r.inputs.plan.summary.parsed, false);
    assert.match(r.inputs.plan.summary.why, /section headings/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('counts ledger entries from a top-level array', () => {
  const dir = mk();
  try {
    writeFileSync(join(dir, 'remediation-ledger.json'), JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ i }))));
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.ledger.state, 'ok');
    assert.equal(r.inputs.ledger.entries, 5);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('marks ledger unreadable when the object carries no entries array', () => {
  const dir = mk();
  try {
    writeFileSync(join(dir, 'remediation-ledger.json'), JSON.stringify({ foo: 1 }));
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.ledger.state, 'unreadable');
    assert.equal(r.inputs.ledger.why, 'remediation-ledger.json carries no entries[]');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('counts codeql findings and marks unreadable when findings is missing', () => {
  const dir = mk();
  try {
    writeFileSync(join(dir, 'codeql-fleet.json'), JSON.stringify({ findings: Array.from({ length: 3 }, (_, i) => i) }));
    let r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.codeqlFleet.state, 'ok');
    assert.equal(r.inputs.codeqlFleet.findings, 3);
    writeFileSync(join(dir, 'codeql-fleet.json'), JSON.stringify({ other: 1 }));
    r = inputsIn(dir, { root: dir });
    assert.equal(r.inputs.codeqlFleet.state, 'unreadable');
    assert.equal(r.inputs.codeqlFleet.why, 'codeql-fleet.json carries no findings[]');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('counts triage runs and verdicts from the handoff directory', () => {
  const dir = mk();
  try {
    const h = join(dir, 'handoff');
    mkdirSync(h, { recursive: true });
    writeFileSync(join(h, 'a.md'), 'x');
    writeFileSync(join(h, 'b.md'), 'x');
    writeFileSync(join(h, 'a.verdict.json'), '{}');
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.outputs.triage.state, 'ok');
    assert.equal(r.outputs.triage.runs, 2);
    assert.equal(r.outputs.triage.verdicts, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('aggregates codeql job states from json files in the jobs directory', () => {
  const dir = mk();
  try {
    const q = join(dir, 'codeql-remediation');
    mkdirSync(q, { recursive: true });
    writeFileSync(join(q, 'j1.json'), JSON.stringify({ state: 'done' }));
    writeFileSync(join(q, 'j2.json'), JSON.stringify({ state: 'done' }));
    writeFileSync(join(q, 'j3.json'), JSON.stringify({ state: 'failed' }));
    writeFileSync(join(q, 'note.txt'), 'x');
    const r = inputsIn(dir, { root: dir });
    assert.equal(r.outputs.codeqlJobs.state, 'ok');
    assert.equal(r.outputs.codeqlJobs.jobs, 3);
    assert.deepEqual(r.outputs.codeqlJobs.byState, { done: 2, failed: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

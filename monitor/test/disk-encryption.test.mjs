// node --test monitor/test/  — the FDE baseline lens: measured, never assumed, and never applied.
//
// The property under test is not "is this box encrypted" — that is a fact about the machine and
// changes nothing about the code. It is that the lens keeps THREE states apart: protected,
// UNPROTECTED, and unmeasured. Collapsing the third into the first launders every box the fleet
// cannot probe into compliance; collapsing it into the second manufactures findings about machines
// nobody looked at. Both directions are asserted here because only one of them is the comfortable
// mistake, and it is the one that would happen.
//
// Every case drives the real adapters through CW_FDE_PROBE/CW_FDE_PLATFORM, so the suite runs with
// no disk, no privileges and no FileVault, on any OS.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MOD = '../disk-encryption.mjs';
const fresh = async () => import(`${MOD}?t=${Math.random()}`);   // env is read at call time; reload anyway

const BASE = {
  comment: 'test declaration',
  rationale: 'test rationale',
  appliesTo: 'test box',
  required: [{ volume: 'root', why: 'test', platforms: { darwin: 'test' }, recoveryNote: 'test' }],
  outOfScope: ['test'],
};
let scratch = null;
function baselineFile(obj = BASE) {
  scratch = mkdtempSync(join(tmpdir(), 'cw-fde-'));
  const p = join(scratch, 'baseline.json');
  writeFileSync(p, JSON.stringify(obj));
  return p;
}
afterEach(() => {
  if (scratch) { rmSync(scratch, { recursive: true, force: true }); scratch = null; }
  delete process.env.CW_FDE_PROBE; delete process.env.CW_FDE_PLATFORM; delete process.env.CW_FDE_BASELINE;
});

describe('the three states stay apart', () => {
  test('FileVault On is protected — exit-0 shape', async () => {
    process.env.CW_FDE_BASELINE = baselineFile();
    process.env.CW_FDE_PLATFORM = 'darwin';
    process.env.CW_FDE_PROBE = 'FileVault is On.';
    const r = (await fresh()).runLens();
    assert.equal(r.state, 'ok');
    assert.equal(r.rows[0].state, 'protected');
    assert.equal(r.findings.length, 0);
  });

  test('FileVault Off is a FINDING, not grey — the box was measured and failed', async () => {
    process.env.CW_FDE_BASELINE = baselineFile();
    process.env.CW_FDE_PLATFORM = 'darwin';
    process.env.CW_FDE_PROBE = 'FileVault is Off.';
    const r = (await fresh()).runLens();
    assert.equal(r.rows[0].state, 'UNPROTECTED');
    assert.equal(r.findings.length, 1);
    assert.equal(r.unknown, false, 'a measured failure must never be reported as unmeasured');
  });

  test('a conversion IN PROGRESS is not yet protection', async () => {
    process.env.CW_FDE_BASELINE = baselineFile();
    process.env.CW_FDE_PLATFORM = 'darwin';
    process.env.CW_FDE_PROBE = 'FileVault is Off, but encryption is in progress.';
    const r = (await fresh()).runLens();
    assert.equal(r.rows[0].state, 'UNPROTECTED',
      'a half-encrypted disk protects nothing yet; reporting it protected is a claim about a future state');
  });

  test('AN UNSUPPORTED PLATFORM IS UNKNOWN — never a pass by omission', async () => {
    process.env.CW_FDE_BASELINE = baselineFile();
    process.env.CW_FDE_PLATFORM = 'aix';
    const r = (await fresh()).runLens();
    assert.equal(r.unknown, true);
    assert.equal(r.unknownReason, 'not-run');
    assert.equal(r.findings.length, 0, 'an unmeasured box must not generate findings either');
    assert.equal(r.rows[0].state, 'unknown');
  });

  test('an unparseable probe answer is UNSTATED, not a verdict', async () => {
    process.env.CW_FDE_BASELINE = baselineFile();
    process.env.CW_FDE_PLATFORM = 'darwin';
    process.env.CW_FDE_PROBE = 'fdesetup: some future output nobody anticipated';
    const r = (await fresh()).runLens();
    assert.equal(r.unknown, true);
    assert.equal(r.unknownReason, 'unstated');
  });
});

describe('the declaration half', () => {
  test('a missing baseline is no-reference — compared against nothing, not compliant', async () => {
    process.env.CW_FDE_BASELINE = join(tmpdir(), `cw-fde-absent-${Math.random()}.json`);
    process.env.CW_FDE_PLATFORM = 'darwin';
    process.env.CW_FDE_PROBE = 'FileVault is On.';
    const r = (await fresh()).runLens();
    assert.equal(r.unknown, true);
    assert.equal(r.unknownReason, 'no-reference',
      'an encrypted disk with nothing declaring what is required is still an unanswered question');
  });

  test('a volume the probe sees and no row claims is UNDECLARED (grey), never a silent pass', async () => {
    process.env.CW_FDE_BASELINE = baselineFile({
      ...BASE,
      required: [{ volume: 'other', why: 'test', platforms: { darwin: 'test' }, recoveryNote: 'test' }],
    });
    process.env.CW_FDE_PLATFORM = 'darwin';
    process.env.CW_FDE_PROBE = 'FileVault is On.';
    const r = (await fresh()).runLens();
    assert.equal(r.state, 'grey');
    assert.equal(r.undeclared.length, 1);
    assert.equal(r.undeclared[0].volume, 'root');
    assert.notEqual(r.state, 'ok', 'an encrypted-but-unlisted volume is unconsidered, not compliant');
  });

  test('the SHIPPED baseline parses and declares at least one volume with a stated reason', async () => {
    const m = await fresh();
    const b = m.loadBaseline();
    assert.ok(!b.unknown, 'the shipped monitor/disk-encryption.json must load');
    assert.ok(b.required.length >= 1);
    for (const r of b.required) {
      assert.ok(r.volume, 'every required row names a volume');
      assert.ok(r.why && r.why.length > 20, `volume ${r.volume} states no reason — a baseline nobody can justify is a rule nobody will keep`);
    }
  });
});

describe('the lens cannot apply anything', () => {
  test('no adapter invokes a mutating verb — status reads only', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL(MOD, import.meta.url)), 'utf8');
    // fdesetup enable/disable, cryptsetup luksFormat/open, manage-bde -on/-off would all APPLY.
    for (const verb of ['enable', 'disable', 'luksFormat', 'luksOpen', '-on', '-off', 'authrestart']) {
      assert.ok(!new RegExp(`['"\\s]${verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\\s]`).test(src),
        `the lens references '${verb}' — applying stays a human act, and this module must only ever read status`);
    }
  });
});

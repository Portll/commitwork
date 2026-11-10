// Computes the ratchet verdict and writes the baseline (bin/bare-catch-ratchet.mjs main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../bare-catch-ratchet.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mk = () => mkdtempSync(join(tmpdir(), 'main-'));
const cap = () => { const o = [], e = []; return { out: { write: (s) => o.push(s) }, err: { write: (s) => e.push(s) }, o, e }; };

test('returns 3 and writes NOT SEEDED when baseline is absent', () => {
  const d = mk();
  try {
    process.env.CW_BARE_CATCH_ROOT = d;
    process.env.CW_BARE_CATCH_BASELINE = join(d, 'b.json');
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    const c = cap();
    const r = main(['node', 'x'], c.out, c.err);
    assert.equal(r, 3);
    assert.equal(c.e[0], 'bare-catch-ratchet: NOT SEEDED \u2014 no baseline at ' + join(d, 'b.json') + ' (ENOENT). Measured 0 bare catches across 0 keys but there is nothing to compare against. A ratchet that re-seeds itself on a missing prior is a gate anyone clears by deleting a file. Seed deliberately: node bin/bare-catch-ratchet.mjs --seed\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('returns 0 and writes re-seeded when --seed is used on an absent baseline', () => {
  const d = mk();
  try {
    process.env.CW_BARE_CATCH_ROOT = d;
    process.env.CW_BARE_CATCH_BASELINE = join(d, 'b.json');
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    const c = cap();
    const r = main(['node', 'x', '--seed'], c.out, c.err);
    assert.equal(r, 0);
    assert.equal(c.o[0], 'bare-catch-ratchet: seeded 0 keys / 0 bare catches \u2192 ' + join(d, 'b.json') + '\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('returns 2 and writes usage error when --rekey is missing its second path', () => {
  const d = mk();
  try {
    process.env.CW_BARE_CATCH_ROOT = d;
    process.env.CW_BARE_CATCH_BASELINE = join(d, 'b.json');
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    writeFileSync(join(d, 'b.json'), JSON.stringify({ keys: {}, critical: [], journal: [] }));
    const c = cap();
    const r = main(['node', 'x', '--rekey', 'a.mjs'], c.out, c.err);
    assert.equal(r, 2);
    assert.equal(c.e[0], 'bare-catch-ratchet: FAILURE \u2014 usage: --rekey <from-path> <to-path>, repo-relative as the keys spell them.\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('returns 2 and writes reason error when --accept is used without --reason', () => {
  const d = mk();
  try {
    process.env.CW_BARE_CATCH_ROOT = d;
    process.env.CW_BARE_CATCH_BASELINE = join(d, 'b.json');
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    writeFileSync(join(d, 'b.json'), JSON.stringify({ keys: {}, critical: [], journal: [] }));
    const c = cap();
    const r = main(['node', 'x', '--accept'], c.out, c.err);
    assert.equal(r, 2);
    assert.equal(c.e[0], 'bare-catch-ratchet: FAILURE \u2014 --accept requires --reason "<why this bare catch is correct>". An unexplained accept is indistinguishable from the erosion this gate exists to stop.\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('returns 1 and writes findings when a new key appears in the tree', () => {
  const d = mk();
  try {
    process.env.CW_BARE_CATCH_ROOT = d;
    process.env.CW_BARE_CATCH_BASELINE = join(d, 'b.json');
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    writeFileSync(join(d, 'b.json'), JSON.stringify({ keys: {}, critical: [], journal: [] }));
    writeFileSync(join(d, 'a.mjs'), 'try {} catch { }');
    const c = cap();
    const r = main(['node', 'x'], c.out, c.err);
    assert.equal(r, 1);
    assert.equal(c.e[0], 'bare-catch-ratchet @ 2024-01-01T00:00:00.000Z\n  measured 1 bare catches across 1 keys (baseline 0 / 0)\n  NEW    a.mjs::<module>  (+1)\n  A bare `catch {` cannot tell a ReferenceError from an ENOENT. If this site legitimately tolerates failure, say so:\n    node bin/bare-catch-ratchet.mjs --accept --reason "best-effort git call; failure is expected"\n  Otherwise import rethrowIfBug from bin/rethrow.mjs and name the error.\n  If the code MOVED rather than grew, record the move without accepting anything else:\n    node bin/bare-catch-ratchet.mjs --rekey <from-path> <to-path>\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('returns 0 and writes pass when the tree matches the baseline exactly', () => {
  const d = mk();
  try {
    process.env.CW_BARE_CATCH_ROOT = d;
    process.env.CW_BARE_CATCH_BASELINE = join(d, 'b.json');
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    writeFileSync(join(d, 'b.json'), JSON.stringify({ keys: { 'a.mjs::<module>': 1 }, critical: [], journal: [] }));
    writeFileSync(join(d, 'a.mjs'), 'try {} catch { }');
    const c = cap();
    const r = main(['node', 'x'], c.out, c.err);
    assert.equal(r, 0);
    assert.equal(c.o[0], 'bare-catch-ratchet @ 2024-01-01T00:00:00.000Z\n  measured 1 bare catches across 1 keys (baseline 1 / 1)\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('returns 2 and writes regression warning when --seed is used on an existing baseline without --force', () => {
  const d = mk();
  try {
    process.env.CW_BARE_CATCH_ROOT = d;
    process.env.CW_BARE_CATCH_BASELINE = join(d, 'b.json');
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    writeFileSync(join(d, 'b.json'), JSON.stringify({ keys: {}, critical: [], journal: [] }));
    const c = cap();
    const r = main(['node', 'x', '--seed'], c.out, c.err);
    assert.equal(r, 2);
    assert.equal(c.e[0], 'bare-catch-ratchet: FAILURE \u2014 baseline already exists. Re-seeding grandfathers whatever is on the tree right now, including a regression that landed five minutes ago. Use --tighten to bank improvements, --accept --reason "<why>" to add a key deliberately, or --seed --force if you really mean to re-photograph the tree.\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('returns 1 and writes strict failure when critical modules have bare catches and --strict-critical is set', () => {
  const d = mk();
  try {
    process.env.CW_BARE_CATCH_ROOT = d;
    process.env.CW_BARE_CATCH_BASELINE = join(d, 'b.json');
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    mkdirSync(join(d, 'monitor'), { recursive: true });
    writeFileSync(join(d, 'b.json'), JSON.stringify({ keys: { 'monitor/extractors.mjs::<module>': 1 }, critical: ['monitor/extractors.mjs'], journal: [] }));
    writeFileSync(join(d, 'monitor', 'extractors.mjs'), 'try {} catch { }');
    const c = cap();
    const r = main(['node', 'x', '--strict-critical'], c.out, c.err);
    assert.equal(r, 1);
    assert.equal(c.e[0], 'bare-catch-ratchet @ 2024-01-01T00:00:00.000Z\n  measured 1 bare catches across 1 keys (baseline 1 / 1)\n  STRICT: 1 bare catch(es) remain in critical modules.\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('returns 0 and writes status with critical modules and top offenders when tree matches baseline', () => {
  const d = mk();
  try {
    process.env.CW_BARE_CATCH_ROOT = d;
    process.env.CW_BARE_CATCH_BASELINE = join(d, 'b.json');
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    writeFileSync(join(d, 'b.json'), JSON.stringify({ keys: { 'a.mjs::<module>': 1 }, critical: ['a.mjs'], journal: [] }));
    writeFileSync(join(d, 'a.mjs'), 'try {} catch { }');
    const c = cap();
    const r = main(['node', 'x', '--status'], c.out, c.err);
    assert.equal(r, 0);
    assert.equal(c.o[0], "bare-catch-ratchet @ 2024-01-01T00:00:00.000Z\n  measured 1 bare catches across 1 keys (baseline 1 / 1)\n  critical modules (target 0):\n    OUTSTANDING a.mjs  1\n  acceptance: tracked set never gained a member = YES; critical modules empty = NO\n  top offenders:\n      1  a.mjs\n");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('returns 1 and writes status with top offenders when a new key appears', () => {
  const d = mk();
  try {
    process.env.CW_BARE_CATCH_ROOT = d;
    process.env.CW_BARE_CATCH_BASELINE = join(d, 'b.json');
    process.env.CW_NOW = '2024-01-01T00:00:00.000Z';
    writeFileSync(join(d, 'b.json'), JSON.stringify({ keys: {}, critical: [], journal: [] }));
    writeFileSync(join(d, 'a.mjs'), 'try {} catch { }');
    const c = cap();
    const r = main(['node', 'x', '--status'], c.out, c.err);
    assert.equal(r, 1);
    assert.equal(c.e[0], 'bare-catch-ratchet @ 2024-01-01T00:00:00.000Z\n  measured 1 bare catches across 1 keys (baseline 0 / 0)\n  NEW    a.mjs::<module>  (+1)\n  critical modules (target 0):\n  acceptance: tracked set never gained a member = NO; critical modules empty = YES\n  top offenders:\n      1  a.mjs\n  A bare `catch {` cannot tell a ReferenceError from an ENOENT. If this site legitimately tolerates failure, say so:\n    node bin/bare-catch-ratchet.mjs --accept --reason "best-effort git call; failure is expected"\n  Otherwise import rethrowIfBug from bin/rethrow.mjs and name the error.\n  If the code MOVED rather than grew, record the move without accepting anything else:\n    node bin/bare-catch-ratchet.mjs --rekey <from-path> <to-path>\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

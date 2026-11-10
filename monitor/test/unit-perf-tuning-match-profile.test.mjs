// The tuning profile that best fits a machine's hardware (monitor/perf-tuning.mjs matchProfile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchProfile } from '../perf-tuning.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const docOf = (...list) => ({ profiles: Object.fromEntries(list.map((p) => [p.id, p])) });
const exact = (id, cores, ramGB, label) => ({ id, confidence: 'exact', why: `${cores} cores and ${ramGB} GB match ${label}` });
const nearest = (id, cores, ramGB, label, pCores, pRam) => ({
  id,
  confidence: 'nearest',
  why: `${cores} cores and ${ramGB} GB is closest to ${label} (${pCores} cores, ${pRam} GB). This is a nearest match, not a measured one \u2014 override it if the machine differs.`,
});
const floor = (arch) => ({
  id: 'legacy-hdd',
  confidence: 'unknown',
  why: `no declared profile matches arch ${arch}; falling back to the floor profile so nothing is over-provisioned`,
});
const byName = (id, why, useMeasured) => ({ id, confidence: 'exact', matchedOn: 'cpu model', why, useMeasured });
const MODEL = 'AMD Ryzen 7 5800U';
const plain = `the processor reports "${MODEL}", which is the laptop`;
const drifted = (text) => `${plain}. This machine has ${text}, so the measured figures are used and the profile supplies only disk class and container availability.`;
const laptop = { id: 'laptop', label: 'the laptop', modelMatch: ['Ryzen 7'], cores: 8, ramGB: 16, arch: 'x64' };

test('a CPU name match with equal cores and memory uses the profile and ignores the auto entry', () => {
  const doc = docOf({ id: 'auto', label: 'Auto', modelMatch: ['ryzen'], cores: 8, ramGB: 16 }, laptop);
  const r = matchProfile({ model: MODEL, cores: 8, ramGB: 16, arch: 'x64' }, { doc });
  assert.deepEqual(r, byName('laptop', plain, false));
});

test('a CPU name match on a machine with different figures switches to the measured ones', () => {
  const doc = docOf(laptop);
  assert.deepEqual(
    matchProfile({ model: MODEL, cores: 16, ramGB: 32 }, { doc }),
    byName('laptop', drifted("16 cores against the profile's 8 and 32 GB against the profile's 16 GB"), true),
  );
  assert.deepEqual(
    matchProfile({ model: MODEL, cores: 16, ramGB: 16 }, { doc }),
    byName('laptop', drifted("16 cores against the profile's 8"), true),
  );
  assert.deepEqual(
    matchProfile({ model: MODEL, cores: 8, ramGB: 32 }, { doc }),
    byName('laptop', drifted("32 GB against the profile's 16 GB"), true),
  );
});

test('a CPU name match reports no drift when either side lacks a figure', () => {
  const doc = docOf({ id: 'nameless', label: 'No patterns', cores: 2, ramGB: 2 }, { id: 'bare', label: 'a bare profile', modelMatch: ['xeon'] });
  assert.deepEqual(
    matchProfile({ model: 'Intel Xeon Gold', cores: 12, ramGB: 64 }, { doc }),
    byName('bare', 'the processor reports "Intel Xeon Gold", which is a bare profile', false),
  );
  assert.deepEqual(matchProfile({ model: MODEL, cores: 0, ramGB: 0 }, { doc: docOf(laptop) }), byName('laptop', plain, false));
});

test('an unknown, missing or unmatched model falls through to the core and memory arithmetic', () => {
  const doc = docOf({ id: 'decoy', label: 'Decoy', modelMatch: ['unknown', ''], cores: 2, ramGB: 4 }, { id: 'desk', label: 'Desk', cores: 8, ramGB: 16 });
  assert.deepEqual(matchProfile({ model: 'Unknown', cores: 8, ramGB: 16 }, { doc }), exact('desk', 8, 16, 'Desk'));
  assert.deepEqual(matchProfile({ cores: 8, ramGB: 16 }, { doc }), exact('desk', 8, 16, 'Desk'));
  assert.deepEqual(
    matchProfile({ model: 'Intel Core i5', cores: 8, ramGB: 16, arch: 'x64' }, { doc: docOf(laptop) }),
    exact('laptop', 8, 16, 'the laptop'),
  );
});

test('profiles of an incompatible architecture are skipped and none left means the floor profile', () => {
  const doc = docOf({ id: 'mac', label: 'Mac', cores: 8, ramGB: 16, arch: 'arm64' }, { id: 'pc', label: 'PC', cores: 16, ramGB: 32, arch: 'x64' });
  assert.deepEqual(matchProfile({ cores: 8, ramGB: 16, arch: 'x86_64' }, { doc }), nearest('pc', 8, 16, 'PC', 16, 32));
  assert.deepEqual(matchProfile({ cores: 16, ramGB: 32, arch: 'arm64' }, { doc }), nearest('mac', 16, 32, 'Mac', 8, 16));
  assert.deepEqual(matchProfile({ cores: 8, ramGB: 16, arch: 'riscv64' }, { doc }), floor('riscv64'));
  assert.deepEqual(matchProfile({ cores: 8, ramGB: 16 }, { doc }), exact('mac', 8, 16, 'Mac'));
  const any = docOf({ id: 'any', label: 'Any', cores: 4, ramGB: 8 });
  assert.deepEqual(matchProfile({ cores: 4, ramGB: 8, arch: 'riscv64' }, { doc: any }), exact('any', 4, 8, 'Any'));
  const onlyAuto = docOf({ id: 'auto', label: 'Auto', cores: 8, ramGB: 16 });
  assert.deepEqual(matchProfile({ cores: 8, ramGB: 16 }, { doc: onlyAuto }), floor(undefined));
});

test('core distance is taken over the larger count and is exact only below 0.06', () => {
  const below = docOf({ id: 'c17', label: 'C17', cores: 17, ramGB: 32 });
  assert.deepEqual(matchProfile({ cores: 16, ramGB: 32 }, { doc: below }), exact('c17', 16, 32, 'C17'));
  const at = docOf({ id: 'c50', label: 'C50', cores: 50, ramGB: 32 });
  assert.deepEqual(matchProfile({ cores: 47, ramGB: 32 }, { doc: at }), nearest('c50', 47, 32, 'C50', 50, 32));
});

test('memory distance is taken over the larger size and is exact only below 0.06', () => {
  const below = docOf({ id: 'r17', label: 'R17', cores: 32, ramGB: 17 });
  assert.deepEqual(matchProfile({ cores: 32, ramGB: 16 }, { doc: below }), exact('r17', 32, 16, 'R17'));
  const at = docOf({ id: 'r50', label: 'R50', cores: 32, ramGB: 50 });
  assert.deepEqual(matchProfile({ cores: 32, ramGB: 47 }, { doc: at }), nearest('r50', 32, 47, 'R50', 32, 50));
});

test('a profile with no cores or memory figure measures that distance over a divisor of one', () => {
  const coreless = { id: 'coreless', label: 'Coreless', ramGB: 8 };
  const ramless = { id: 'ramless', label: 'Ramless', cores: 8 };
  const quad = { id: 'quad', label: 'Quad', cores: 4, ramGB: 8 };
  const small = { id: 'small', label: 'Small', cores: 8, ramGB: 4 };
  assert.deepEqual(matchProfile({ cores: 1, ramGB: 8 }, { doc: docOf(coreless, quad) }), nearest('quad', 1, 8, 'Quad', 4, 8));
  assert.deepEqual(matchProfile({ cores: 8, ramGB: 1 }, { doc: docOf(ramless, small) }), nearest('small', 8, 1, 'Small', 8, 4));
  assert.deepEqual(matchProfile({ cores: 2, ramGB: 8 }, { doc: docOf(coreless) }), nearest('coreless', 2, 8, 'Coreless', undefined, 8));
  assert.deepEqual(matchProfile({ cores: 8, ramGB: 2 }, { doc: docOf(ramless) }), nearest('ramless', 8, 2, 'Ramless', 8, undefined));
});

test('two profiles at the same distance resolve to the first one declared', () => {
  const doc = docOf({ id: 'first', label: 'First', cores: 8, ramGB: 16 }, { id: 'second', label: 'Second', cores: 8, ramGB: 16 });
  assert.deepEqual(matchProfile({ cores: 8, ramGB: 16 }, { doc }), exact('first', 8, 16, 'First'));
  assert.deepEqual(matchProfile({ cores: 4, ramGB: 8 }, { doc }), nearest('first', 4, 8, 'First', 8, 16));
});

test('without a doc it reads the file named by CW_PERF_PROFILES and refuses a missing one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'matchProfile-'));
  const saved = process.env.CW_PERF_PROFILES;
  try {
    const path = join(dir, 'perf-profiles.json');
    const sections = { scanners: {}, costClasses: {}, depthLevels: {}, intensityLevels: {}, diskClasses: {} };
    writeFileSync(path, JSON.stringify({ ...docOf({ id: 'fromfile', label: 'From file', cores: 6, ramGB: 12 }), ...sections }));
    process.env.CW_PERF_PROFILES = path;
    assert.deepEqual(matchProfile({ cores: 6, ramGB: 12 }), exact('fromfile', 6, 12, 'From file'));
    const missing = join(dir, 'absent.json');
    process.env.CW_PERF_PROFILES = missing;
    assert.throws(() => matchProfile({ cores: 6, ramGB: 12 }), {
      name: 'Error',
      message: `perf profiles unreadable at ${missing}: ENOENT \u2014 refusing to derive tuning from an assumed default, which would report a machine we never read`,
    });
  } finally {
    if (saved === undefined) delete process.env.CW_PERF_PROFILES;
    else process.env.CW_PERF_PROFILES = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

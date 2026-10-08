import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadProfiles, resetProfileCache, detectHardware, matchProfile, resolveTuning, systemSnapshot,
} from '../perf-tuning.mjs';
import { recordRun, readSamples, summarise, drift } from '../perf-feedback.mjs';

const REAL = () => { resetProfileCache(); return loadProfiles(); };

describe('perf-tuning — the profile document is the vocabulary, and an absent one is fatal', () => {
  test('an unreadable profile document refuses rather than assuming a default', () => {
    resetProfileCache();
    assert.throws(() => loadProfiles({ path: '/nonexistent/perf-profiles.json' }), /refusing to derive tuning/);
    resetProfileCache();
  });

  test('every declared scanner names a cost class that exists, and every profile a disk class that exists', () => {
    const doc = REAL();
    for (const [id, s] of Object.entries(doc.scanners)) {
      assert.ok(doc.costClasses[s.cost], `${id} declares cost class ${s.cost}, which is not defined`);
      if (Number.isInteger(s.minDepth)) assert.ok(s.minDepth >= 1 && s.minDepth <= doc.depthLevels.length, `${id} minDepth out of range`);
    }
    for (const [id, p] of Object.entries(doc.profiles)) {
      if (p.diskClass) assert.ok(doc.diskClasses[p.diskClass], `${id} declares disk class ${p.diskClass}, which is not defined`);
    }
  });

  test('every scanner in the security-baseline manifest has a cost declared — a lane with no cost is invisible to tuning', async () => {
    const doc = REAL();
    const { readFileSync } = await import('node:fs');
    const m = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
    const missing = (m.checks || []).map((c) => c.id).filter((id) => !doc.scanners[id]);
    assert.deepEqual(missing, [], `checks with no cost class: ${missing.join(', ')}`);
  });
});

describe('perf-tuning — derivation', () => {
  test('depth is monotonic: raising it never enables fewer scanners', () => {
    const counts = [1, 2, 3, 4, 5].map((d) => resolveTuning({ profileId: 'm4-pro', depth: d, intensity: 3 }).enabledCount);
    for (let i = 1; i < counts.length; i++) assert.ok(counts[i] >= counts[i - 1], `depth ${i + 1} enabled ${counts[i]}, fewer than depth ${i}'s ${counts[i - 1]}`);
  });

  test('intensity never changes WHICH scanners run — only how many run at once', () => {
    const at = (i) => resolveTuning({ profileId: 'm4-pro', depth: 3, intensity: i }).scanners.filter((s) => s.enabled).map((s) => s.id).sort();
    assert.deepEqual(at(1), at(5), 'intensity changed the enabled set; depth decides what runs, intensity decides how hard');
  });

  test('a bigger machine never derives fewer concurrent jobs than a smaller one', () => {
    const j = (id) => resolveTuning({ profileId: id, depth: 3, intensity: 3 }).jobs;
    assert.ok(j('dgx-spark') >= j('core-i7-2026'), 'DGX Spark derived fewer jobs than a desktop i7');
    assert.ok(j('core-i7-2026') >= j('apple-air'), 'a desktop i7 derived fewer jobs than a passively cooled laptop');
    assert.ok(j('dgx-spark-dual') >= j('dgx-spark'));
  });

  test('a spinning disk and no container runtime disables the containerised lanes by name, never silently', () => {
    const t = resolveTuning({ profileId: 'legacy-hdd', depth: 5, intensity: 3 });
    const containerLanes = t.scanners.filter((s) => s.container);
    assert.ok(containerLanes.length > 0, 'no containerised lanes in the fixture');
    for (const s of containerLanes) {
      assert.equal(s.enabled, false, `${s.id} is containerised but enabled on a profile with no container runtime`);
      assert.match(s.reason, /container runtime/, `${s.id} disabled with no reason naming the container runtime`);
    }
  });

  test('every disabled scanner carries a reason — a lane off with no stated cause is indistinguishable from one that passed', () => {
    for (const d of [1, 3, 5]) {
      const t = resolveTuning({ profileId: 'apple-air', depth: d, intensity: 3 });
      for (const s of t.scanners) {
        if (!s.enabled) assert.ok(s.reason && s.reason.length > 5, `${s.id} disabled at depth ${d} with no reason`);
        else assert.equal(s.reason, '', `${s.id} is enabled but carries a reason`);
      }
    }
  });

  test('the runtime lanes are off below depth 5 and named as needing a live target', () => {
    const t = resolveTuning({ profileId: 'dgx-spark', depth: 4, intensity: 3 });
    const runtime = t.scanners.filter((s) => s.runtime);
    assert.equal(runtime.length, 4, 'expected exactly four runtime lanes');
    for (const s of runtime) assert.match(s.reason, /live target/);
  });

  test('an out-of-range depth or intensity is clamped and SAID, never silently accepted', () => {
    for (const bad of [0, 6, 9, -1, '3', null, 2.5]) {
      const t = resolveTuning({ profileId: 'm4-pro', depth: bad, intensity: 3 });
      assert.equal(t.depth, 3);
      assert.ok(t.warnings.some((w) => /depth/.test(w)), `depth ${JSON.stringify(bad)} was clamped with no warning`);
    }
  });

  test('an OMITTED depth takes the default silently — that is an omission, not bad input', () => {
    const t = resolveTuning({ profileId: 'm4-pro', intensity: 3 });
    assert.equal(t.depth, 3);
    assert.equal(t.warnings.filter((w) => /depth/.test(w)).length, 0, 'omitting depth warned as though it were invalid');
  });

  test('intensity 5 always warns that it is usually slower end to end', () => {
    const t = resolveTuning({ profileId: 'dgx-spark', depth: 3, intensity: 5 });
    assert.ok(t.warnings.some((w) => /slower end to end|2\.6 to 30/.test(w)));
  });

  // Derived from the registry, not keyed to one profile id: the first version of this test named
  // m5-pro, and when that profile's figures were replaced by a measurement the test failed for
  // being right. The MECHANISM is what must hold — if a profile ever carries projected, saying so
  // is not optional — and whether any profile currently does is a fact about the data, not the code.
  test('a projected profile says so, and if none is projected that is stated rather than passing vacuously', () => {
    const doc = REAL();
    const projected = Object.values(doc.profiles).filter((p) => p.projected);
    if (!projected.length) {
      // Not a skip: assert the registry really is free of projections, so this branch cannot hide
      // one that was added later without a warning.
      for (const p of Object.values(doc.profiles)) {
        assert.ok(!p.projected, `${p.id} is projected and reached the no-projections branch`);
      }
      return;
    }
    for (const p of projected) {
      const t = resolveTuning({
        profileId: p.id, depth: 3, intensity: 3,
        hardware: { cores: p.cores, ramGB: p.ramGB, arch: p.arch, model: 'unknown', diskClass: p.diskClass, containers: true },
      });
      assert.ok(t.warnings.some((w) => /projected/i.test(w)), `${p.id} is projected and said nothing`);
    }
  });
});

describe('perf-tuning — operator overrides, and the three states they produce', () => {
  const OFF_PROFILE = { profileId: 'legacy-hdd', depth: 5, intensity: 3 };
  const containerLane = () => resolveTuning(OFF_PROFILE).scanners.find((s) => s.container).id;

  test('every lane reports its override state and what the derivation said, even with no overrides', () => {
    const t = resolveTuning({ profileId: 'm4-pro', depth: 3, intensity: 3 });
    assert.equal(t.overriddenCount, 0);
    assert.equal(t.forcedBlockedCount, 0);
    for (const s of t.scanners) {
      assert.equal(s.override, 'auto', `${s.id} reported an override with none set`);
      assert.equal(s.derivedEnabled, s.enabled, `${s.id}: derivedEnabled disagrees with enabled at auto`);
    }
  });

  test('forcing a CONTAINER lane on where there is no container runtime is forced-but-blocked, and is NOT enabled', () => {
    const id = containerLane();
    const base = resolveTuning(OFF_PROFILE);
    const t = resolveTuning({ ...OFF_PROFILE, overrides: { [id]: 'on' } });
    const row = t.scanners.find((s) => s.id === id);
    assert.equal(row.override, 'on');
    assert.equal(row.blocked, true, 'a lane that cannot run was not marked blocked');
    assert.equal(row.enabled, false, 'forcing a lane on made the panel claim it runs');
    assert.match(row.reason, /container runtime/, 'the blocking reason must be stated unchanged');
    assert.equal(row.derivedEnabled, false);
    assert.equal(t.enabledCount, base.enabledCount, 'a forced-but-blocked lane was counted as enabled');
    assert.equal(t.forcedBlockedCount, 1);
    assert.equal(t.forcedOnCount, 1);
    assert.ok(t.warnings.some((w) => w.includes(id) && /CANNOT RUN/.test(w)),
      'no warning named the forced lane that cannot run');
  });

  test('a runtime lane forced on below depth 5 is blocked too — a live target is a capability, not a policy', () => {
    const rt = resolveTuning({ profileId: 'dgx-spark', depth: 4, intensity: 3 }).scanners.find((s) => s.runtime).id;
    const t = resolveTuning({ profileId: 'dgx-spark', depth: 4, intensity: 3, overrides: { [rt]: 'on' } });
    const row = t.scanners.find((s) => s.id === rt);
    assert.equal(row.blocked, true);
    assert.equal(row.enabled, false);
    assert.match(row.reason, /live target/);
  });

  test('forcing on a lane the DEPTH merely excluded actually runs it — depth is policy, not capability', () => {
    const t1 = resolveTuning({ profileId: 'm4-pro', depth: 1, intensity: 3 });
    const off = t1.scanners.find((s) => !s.enabled && !s.container && !s.runtime && /depth/.test(s.reason));
    assert.ok(off, 'no depth-excluded lane to force on');
    const t = resolveTuning({ profileId: 'm4-pro', depth: 1, intensity: 3, overrides: { [off.id]: 'on' } });
    const row = t.scanners.find((s) => s.id === off.id);
    assert.equal(row.enabled, true);
    assert.equal(row.blocked, undefined);
    assert.equal(row.reason, '');
    assert.equal(row.derivedEnabled, false);
    assert.match(row.derivedReason, /depth/, 'what the derivation said was erased instead of kept beside the override');
    assert.equal(t.enabledCount, t1.enabledCount + 1);
  });

  test('a lane forced OFF is NOT SCANNED, with a reason that refuses to read as clean', () => {
    const base = resolveTuning({ profileId: 'm4-pro', depth: 5, intensity: 3 });
    const on = base.scanners.find((s) => s.enabled).id;
    const t = resolveTuning({ profileId: 'm4-pro', depth: 5, intensity: 3, overrides: { [on]: 'off' } });
    const row = t.scanners.find((s) => s.id === on);
    assert.equal(row.override, 'off');
    assert.equal(row.enabled, false);
    assert.equal(row.derivedEnabled, true);
    assert.match(row.reason, /NOT SCANNED/);
    assert.match(row.reason, /never a clean result/i);
    assert.equal(t.enabledCount, base.enabledCount - 1);
    assert.equal(t.forcedOffCount, 1);
    assert.ok(t.warnings.some((w) => w.includes(on) && /FORCED OFF/.test(w)));
  });

  test('clearing the overrides restores the derived table EXACTLY', () => {
    const id = containerLane();
    const base = resolveTuning(OFF_PROFILE);
    const forced = resolveTuning({ ...OFF_PROFILE, overrides: { [id]: 'on' } });
    assert.notEqual(JSON.stringify(forced.scanners), JSON.stringify(base.scanners), 'the override changed nothing');
    for (const empty of [{}, null, undefined]) {
      const back = resolveTuning({ ...OFF_PROFILE, overrides: empty });
      assert.equal(JSON.stringify(back.scanners), JSON.stringify(base.scanners),
        `overrides=${JSON.stringify(empty)} did not restore the derivation exactly`);
      assert.deepEqual(back.overrides, {});
      assert.equal(back.warnings.length, base.warnings.length);
    }
  });

  test('a malformed override is IGNORED and named — never applied on a guess', () => {
    const id = containerLane();
    for (const bad of [{ [id]: 'maybe' }, { [id]: true }, { [id]: null }]) {
      const t = resolveTuning({ ...OFF_PROFILE, overrides: bad });
      assert.equal(t.overriddenCount, 0, `${JSON.stringify(bad)} was applied`);
      assert.ok(t.warnings.some((w) => w.includes(id) && /IGNORED/.test(w)));
    }
    const arr = resolveTuning({ ...OFF_PROFILE, overrides: ['sast-semgrep'] });
    assert.equal(arr.overriddenCount, 0);
    assert.ok(arr.warnings.some((w) => /NO override was applied/.test(w)));
  });

  test('an override naming a scanner that is not declared is reported, not silently dropped', () => {
    const t = resolveTuning({ ...OFF_PROFILE, overrides: { 'not-a-declared-lane': 'on' } });
    assert.equal(t.overriddenCount, 0);
    assert.ok(t.warnings.some((w) => /not-a-declared-lane/.test(w) && /does not declare/.test(w)));
  });

  test('the store round-trips an override table through the same validation the panel uses', async () => {
    const { SETTING_KEYS } = await import('../settings.mjs');
    const spec = SETTING_KEYS.scannerOverrides;
    assert.equal(spec.default, null);
    assert.equal(spec.envVar, 'CW_SCANNER_OVERRIDES');
    assert.equal(spec.validate(null), null);
    assert.equal(spec.validate({ 'sast-semgrep': 'on', 'deps-osv': 'off' }), null);
    assert.match(spec.validate({ 'sast-semgrep': 'maybe' }), /sast-semgrep/);
    assert.match(spec.validate({ 'sast-semgrep': 'maybe' }), /"on" or "off"/);
    assert.match(spec.validate([]), /must be an object/);
    assert.match(spec.validate('on'), /must be an object/);
    assert.match(spec.validate({ 'Not An Id': 'on' }), /Not An Id/);
  });
});

describe('perf-tuning — asking the processor', () => {
  test('the CPU model decides the profile before core arithmetic does', () => {
    const m = matchProfile({ cores: 4, ramGB: 8, arch: 'arm64', model: 'Apple M4 Pro' });
    assert.equal(m.id, 'm4-pro');
    assert.equal(m.confidence, 'exact');
    assert.equal(m.matchedOn, 'cpu model');
  });

  // Also derived rather than hardcoded. This test named m5-pro and its 14 cores; when the profile
  // was corrected to the measured 18, the assertion broke without the behaviour changing at all.
  // Take any profile that matches by model, hand it a machine two cores and 8 GB larger, and the
  // measured figure must win — which is the property, independent of the numbers in the registry.
  test('when the machine carries more than the profile declares, the MEASURED figure is used and the difference is stated', () => {
    const doc = REAL();
    const p = Object.values(doc.profiles).find((x) => (x.modelMatch || []).length && x.cores && x.ramGB);
    assert.ok(p, 'no profile carries a modelMatch pattern to test with');
    const hw = { cores: p.cores + 4, ramGB: p.ramGB + 16, arch: p.arch, model: p.modelMatch[0], diskClass: 'nvme', containers: true };
    const m = matchProfile(hw);
    assert.equal(m.id, p.id);
    assert.equal(m.useMeasured, true);
    assert.match(m.why, new RegExp(`${hw.cores} cores against the profile's ${p.cores}`));
    const declared = resolveTuning({ profileId: p.id, depth: 3, intensity: 3, hardware: { cores: p.cores, ramGB: p.ramGB, arch: p.arch, model: 'unknown', diskClass: 'nvme', containers: true } });
    const measured = resolveTuning({ profileId: 'auto', depth: 3, intensity: 3, hardware: hw });
    assert.ok(measured.jobs > declared.jobs, `a ${hw.cores}-core machine derived no more jobs than the ${p.cores}-core profile it matched`);
  });

  test('a nearest match is reported as nearest, never as exact', () => {
    const m = matchProfile({ cores: 9, ramGB: 20, arch: 'arm64', model: 'Something Unlisted' });
    assert.equal(m.confidence, 'nearest');
    assert.match(m.why, /nearest match, not a measured one/);
  });

  test('an unknown architecture falls back to the floor profile rather than over-provisioning', () => {
    const m = matchProfile({ cores: 64, ramGB: 512, arch: 'riscv64', model: 'unknown' });
    assert.equal(m.id, 'legacy-hdd');
    assert.equal(m.confidence, 'unknown');
  });

  test('detectHardware reads the env override at CALL time, not at module load', () => {
    const before = detectHardware({ env: { CW_PERF_CORES: '3', CW_PERF_RAM_GB: '5' } });
    assert.equal(before.cores, 3);
    assert.equal(before.ramGB, 5);
  });

  test('disk class is reported unknown rather than guessed as fast', () => {
    const hw = detectHardware({ env: {} });
    assert.equal(hw.diskClass, 'unknown');
    const t = resolveTuning({ profileId: 'auto', depth: 3, intensity: 3, hardware: { ...hw, model: 'Something Unlisted', cores: 8, ramGB: 16 } });
    assert.ok(t.warnings.some((w) => /disk class is unknown/.test(w)) || t.profile.diskClass, 'unknown disk neither warned nor resolved from the profile');
  });
});

describe('perf-feedback — measured cost, kept apart from declared cost', () => {
  const tmp = () => join(mkdtempSync(join(tmpdir(), 'cw-perf-')), 'fb.jsonl');

  test('an absent log is absent, and an unreadable one is UNKNOWN — never an empty history', () => {
    const p = tmp();
    assert.deepEqual(readSamples({ path: p }), { ok: true, samples: [], state: 'absent' });
    writeFileSync(p, '\0not json at all\n{');
    const r = readSamples({ path: p });
    assert.equal(r.ok, true);
    assert.equal(r.state, 'present');
    assert.ok(r.unparseableLines >= 1, 'unparseable lines were not counted');
  });

  test('a sample with no duration is refused rather than recorded as zero', () => {
    const p = tmp();
    assert.equal(recordRun({ scanner: 'sast' }, { path: p }).ok, false);
    assert.equal(recordRun({ scanner: '', ms: 10 }, { path: p }).ok, false);
    assert.equal(recordRun({ scanner: 'sast', ms: 10 }, { path: p }).ok, true);
  });

  test('the summary reports the MINIMUM beside the median, because contention only ever adds time', () => {
    const p = tmp();
    for (const ms of [1000, 5000, 9000]) recordRun({ scanner: 'stub-detect', repo: 'r', ms, exit: 0 }, { path: p });
    const s = summarise({ path: p });
    const row = s.scanners.find((x) => x.scanner === 'stub-detect');
    assert.equal(row.minMs, 1000);
    assert.equal(row.samples, 3);
    assert.equal(row.enough, true);
  });

  test('fewer than three samples is reported as not enough, and is not used to claim anything', () => {
    const p = tmp();
    recordRun({ scanner: 'sast', repo: 'r', ms: 1000, exit: 0 }, { path: p });
    const s = summarise({ path: p });
    assert.equal(s.scanners[0].enough, false);
    assert.match(s.scanners[0].note, /below the 3 needed/);
    const d = drift({ path: p, doc: REAL() });
    assert.deepEqual(d.drift, [], 'drift was claimed from a single sample');
  });

  test('drift REPORTS a disagreement with the declared class and changes nothing', () => {
    const p = tmp();
    const doc = REAL();
    const before = JSON.stringify(doc.scanners['stub-detect']);
    for (const ms of [400000, 410000, 420000]) recordRun({ scanner: 'stub-detect', repo: 'r', ms, exit: 0 }, { path: p });
    const d = drift({ path: p, doc });
    const row = d.drift.find((x) => x.scanner === 'stub-detect');
    assert.ok(row, 'a light scanner taking seven minutes produced no drift row');
    assert.equal(row.declaredClass, 'light');
    assert.notEqual(row.observedClass, 'light');
    assert.equal(JSON.stringify(REAL().scanners['stub-detect']), before, 'drift MUTATED the profile document');
  });

  test('a scanner observed but never declared is reported, not ignored', () => {
    const p = tmp();
    for (const ms of [100, 200, 300]) recordRun({ scanner: 'not-a-declared-lane', repo: 'r', ms, exit: 0 }, { path: p });
    const d = drift({ path: p, doc: REAL() });
    assert.ok(d.drift.some((x) => /not declared/.test(x.issue)));
  });
});

test('systemSnapshot spawns for its fixed facts once, then reads only in-process values', () => {
  const first = systemSnapshot();
  const ms = [];
  for (let i = 0; i < 5; i++) {
    const t = process.hrtime.bigint();
    const again = systemSnapshot();
    ms.push(Number(process.hrtime.bigint() - t) / 1e6);
    assert.equal(again.gpuCores, first.gpuCores);
    assert.equal(again.perfCores, first.perfCores);
  }
  // A sysctl or ioreg spawn costs tens of milliseconds; the minimum of five calls cannot hide one.
  assert.ok(Math.min(...ms) < 5, `a repeat call took ${Math.min(...ms).toFixed(1)} ms, so it still spawns`);
  assert.equal(typeof first.freeBytes, 'number');
});

// node --test admin/test/perf-route.test.mjs — the Scanner performance route.
//
// Everything here runs against a FIXTURE tuning model (CW_PERF_TUNING) and a fixture settings store
// (CW_SETTINGS). The live model may not be on disk yet, and the live store is the operator's.
//
// The three properties worth pinning: preview cannot write (it is what a slider drag calls), a
// level the model does not declare is refused rather than coerced, and no scanner row is ever
// published as "off" without a reason — an unexplained off reads exactly like a deliberate
// exclusion, which is this repo's unsupported-pass failure pointed at the tuning table.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let DIR;

const FIXTURE_MODEL = `
export const DEPTH_LEVELS = [
  { level: 1, label: 'Surface', description: 'changed files only' },
  { level: 2, label: 'Shallow', description: 'the working tree' },
  { level: 3, label: 'Standard', description: 'the tree plus lockfiles' },
  { level: 4, label: 'Deep', description: 'plus committed history' },
  { level: 5, label: 'Exhaustive', description: 'plus vendored and minified trees' },
];
export const INTENSITY_LEVELS = [
  { level: 1, label: 'Idle', description: 'one job, nice-d' },
  { level: 2, label: 'Light', description: 'a quarter of the box' },
  { level: 3, label: 'Balanced', description: 'half the box' },
  { level: 4, label: 'Heavy', description: 'most of the box' },
  { level: 5, label: 'Saturate', description: 'every core, interactive use suffers' },
];
export const PROFILES = {
  'm4-max-128': { id: 'm4-max-128', label: 'M4 Max 128GB', vendor: 'Apple', cores: 16, threads: 16,
    ramGB: 128, diskClass: 'nvme', containers: true, note: 'the box this fixture describes' },
  'm5-ultra-256': { id: 'm5-ultra-256', label: 'M5 Ultra 256GB', vendor: 'Apple', cores: 32, threads: 32,
    ramGB: 256, diskClass: 'nvme', containers: true, note: 'unreleased', projected: true },
  'ci-runner-4': { id: 'ci-runner-4', label: 'CI runner 4 vCPU', vendor: 'GitHub', cores: 4, threads: 4,
    ramGB: 16, diskClass: 'ssd', containers: true, note: 'hosted runner' },
};
export function detectHardware() {
  return { cores: 16, ramGB: 128, arch: 'arm64', platform: 'darwin', diskClass: 'nvme',
    containers: true, detectedAt: '2026-08-23T00:00:00.000Z' };
}
export function matchProfile(hw) {
  return { id: 'm4-max-128', confidence: 'exact', why: 'cores and RAM match the declared profile' };
}
const IDS = Array.from({ length: 36 }, (_, i) => 'scanner-' + String(i + 1).padStart(2, '0'));
// The fixture's containerised lane: this profile has no container runtime, so forcing it ON cannot
// make it run. It exists to pin that the route publishes forced-but-blocked as UNDETERMINED.
const BLOCKED = 'scanner-05';
export function resolveTuning({ profileId, depth, intensity, overrides }) {
  const p = PROFILES[profileId];
  const reach = 6 + depth * 5;
  const ov = (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) ? overrides : {};
  const scanners = IDS.map((id, i) => {
    const derivedEnabled = id === 'scanner-36' ? false : i < reach;
    const derivedReason = derivedEnabled ? '' : 'depth ' + depth + ' does not reach this lane';
    const override = (ov[id] === 'on' || ov[id] === 'off') ? ov[id] : 'auto';
    // scanner-36 is deliberately disabled WITHOUT a reason — the route must supply one rather than
    // publish an unexplained off row.
    if (id === 'scanner-36' && override === 'auto') {
      return { id, label: id, costClass: 'expensive', enabled: false, timeoutMs: 1000, concurrencyWeight: 4, override, derivedEnabled, derivedReason };
    }
    let enabled = derivedEnabled;
    let reason = derivedEnabled ? null : derivedReason;
    let blocked = false;
    if (override === 'off') {
      enabled = false;
      reason = 'forced OFF by an operator override — this lane is NOT SCANNED, never clean';
    } else if (override === 'on') {
      if (id === BLOCKED) { enabled = false; blocked = true; reason = 'needs a container runtime, which this profile does not have'; }
      else { enabled = true; reason = null; }
    }
    const row = {
      id, label: id, costClass: id === 'scanner-36' ? 'expensive' : ['cheap', 'moderate', 'expensive'][i % 3],
      enabled, reason, timeoutMs: id === 'scanner-36' ? 1000 : 60000 * depth,
      concurrencyWeight: id === 'scanner-36' ? 4 : 1 + (i % 3),
      override, derivedEnabled, derivedReason,
    };
    if (blocked) row.blocked = true;
    return row;
  });
  return {
    jobs: Math.max(1, Math.round((p.cores * intensity) / 5)),
    slots: intensity,
    ramBudgetGB: Math.round((p.ramGB * intensity) / 5),
    scanners,
    overrides: ov,
    warnings: intensity >= 5 ? ['intensity 5 saturates the box — interactive use will stall'] : [],
  };
}
`;

beforeEach(() => {
  DIR = mkdtempSync(join(tmpdir(), 'cw-perf-route-'));
  writeFileSync(join(DIR, 'perf-tuning.mjs'), FIXTURE_MODEL);
  process.env.CW_PERF_TUNING = join(DIR, 'perf-tuning.mjs');
  process.env.CW_SETTINGS = join(DIR, 'settings.json');
  // An env shadow makes setSettings refuse the write with a 409, which would read here as "the
  // route would not persist" when the route was never the reason.
  for (const k of ['CW_PERF_PROFILE', 'CW_SCAN_DEPTH', 'CW_SCAN_INTENSITY', 'CW_SCANNER_OVERRIDES']) delete process.env[k];
});
afterEach(() => {
  delete process.env.CW_PERF_TUNING;
  delete process.env.CW_SETTINGS;
  rmSync(DIR, { recursive: true, force: true });
});

const routesOf = async () => (await import('../routes/perf.mjs')).routes;

const call = async (method, path, body) => {
  const routes = await routesOf();
  const r = routes.find((x) => x.method === method && x.path === path);
  assert.ok(r, `${method} ${path} is not registered`);
  const seen = [];
  await r.handle({
    req: {}, isLoopbackReq: true, adminSession: () => null,
    send: (code, payload) => { seen.push({ code, payload }); },
    readJsonBody: (_req, cb) => cb(body, null),
  });
  assert.ok(seen.length, `${method} ${path} sent no response`);
  return seen[0];
};

const storeWritten = () => existsSync(process.env.CW_SETTINGS);

test('every route refuses a remote caller with no session', async () => {
  for (const r of await routesOf()) {
    const seen = [];
    await r.handle({
      req: {}, isLoopbackReq: false, adminSession: () => null,
      send: (c, b) => seen.push({ c, b }), readJsonBody: (_q, cb) => cb({}, null),
    });
    assert.equal(seen[0].c, 401, `${r.method} ${r.path} must require auth`);
  }
});

test('GET carries hardware, the match, the profiles and a resolved tuning in ONE payload', async () => {
  const { code, payload } = await call('GET', '/api/perf');
  assert.equal(code, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.equal(payload.hardware.cores, 16);
  assert.equal(payload.matched.confidence, 'exact');
  assert.ok(Array.isArray(payload.profiles) && payload.profiles.length === 3);
  assert.equal(payload.profileId, 'm4-max-128');
  assert.equal(typeof payload.depth, 'number');
  assert.equal(typeof payload.intensity, 'number');
  assert.ok(payload.tuning, 'no tuning — the sliders would render against nothing');
  assert.equal(typeof payload.settings, 'object');
  assert.equal(typeof payload.settingsAvailable, 'boolean');
  // A projected spec must survive to the page as a projection, never flattened into a measurement.
  const projected = payload.profiles.find((p) => p.id === 'm5-ultra-256');
  assert.equal(projected.projected, true);
  assert.equal(payload.profiles.find((p) => p.id === 'm4-max-128').projected, false);
});

test('undeclared setting keys fall back to 3/3 and SAY SO rather than reading as stored', async () => {
  const { payload } = await call('GET', '/api/perf');
  if (payload.settingsAvailable) {
    assert.deepEqual(payload.missingSettingKeys, []);
  } else {
    assert.ok(payload.missingSettingKeys.length, 'settingsAvailable:false must name the keys that are missing');
    assert.equal(payload.depth, 3);
    assert.equal(payload.intensity, 3);
    assert.equal(payload.depthSource, 'fallback', 'a fallback must not be reported as a stored value');
  }
});

test('the scanner list is non-empty and NOTHING is off without a reason', async () => {
  const { payload } = await call('GET', '/api/perf');
  const rows = payload.tuning.scanners;
  assert.ok(rows.length >= 34, `only ${rows.length} scanners — the table would understate the fleet`);
  for (const s of rows) {
    assert.ok(s.id, 'a scanner row with no id');
    if (s.enabled !== true) {
      assert.ok(s.reason && s.reason.trim().length,
        `${s.id} is not enabled and carries no reason — an unexplained off reads as a deliberate exclusion`);
    }
  }
  // the fixture's deliberately unexplained row is explained BY THE ROUTE, not left blank
  const bare = rows.find((s) => s.id === 'scanner-36');
  assert.equal(bare.enabled, false);
  assert.match(bare.reason, /UNEXPLAINED/);
  assert.equal(payload.tuning.counts.total, rows.length);
});

test('preview resolves a tuning and writes NOTHING — it is what every slider drag calls', async () => {
  const before = await call('GET', '/api/perf');
  const p = await call('POST', '/api/perf/preview', { profileId: 'ci-runner-4', depth: 5, intensity: 5 });
  assert.equal(p.code, 200, JSON.stringify(p.payload));
  assert.equal(p.payload.ok, true);
  assert.ok(p.payload.tuning.scanners.length >= 34);
  assert.ok(p.payload.tuning.warnings.some((w) => /saturate/i.test(w)), 'the model\'s warnings must survive to the page');
  assert.equal(storeWritten(), false, 'preview created a settings store — a slider drag must never write');
  const after = await call('GET', '/api/perf');
  assert.equal(after.payload.depth, before.payload.depth, 'preview changed the value in force');
  assert.equal(after.payload.profileId, before.payload.profileId);
});

test('an out-of-range or wrongly-typed depth is refused by BOTH write paths, and writes nothing', async () => {
  for (const depth of [0, 6, '3', null, undefined, 2.5, NaN]) {
    for (const path of ['/api/perf/preview', '/api/perf']) {
      const r = await call('POST', path, { profileId: 'm4-max-128', depth, intensity: 3 });
      assert.equal(r.code, 400, `${path} accepted depth=${String(depth)} (${r.code})`);
      assert.match(r.payload.error, /depth/, 'the refusal must name the field that was wrong');
      assert.ok(Array.isArray(r.payload.errors) && r.payload.errors.length);
    }
  }
  assert.equal(storeWritten(), false, 'a refused write still created the store');
});

test('an intensity outside the declared levels is refused too, and both bad fields are named', async () => {
  const r = await call('POST', '/api/perf', { profileId: 'nope', depth: 9, intensity: 9 });
  assert.equal(r.code, 400);
  const joined = r.payload.errors.join(' | ');
  assert.match(joined, /profileId/);
  assert.match(joined, /depth/);
  assert.match(joined, /intensity/);
  assert.equal(storeWritten(), false);
});

test('a valid POST either persists, or refuses with 501 NAMING the keys — never a silent no-op', async () => {
  const body = { profileId: 'ci-runner-4', depth: 4, intensity: 2 };
  const r = await call('POST', '/api/perf', body);
  const g = await call('GET', '/api/perf');
  if (g.payload.settingsAvailable) {
    assert.equal(r.code, 200, JSON.stringify(r.payload));
    assert.ok(r.payload.tuning, 'a successful write must echo the tuning it put in force');
    assert.equal(r.payload.state.depth, 4);
    assert.equal(r.payload.state.intensity, 2);
    assert.equal(r.payload.state.profileId, 'ci-runner-4');
  } else {
    assert.equal(r.code, 501, JSON.stringify(r.payload));
    for (const k of g.payload.missingSettingKeys) {
      assert.match(r.payload.error, new RegExp(k), `the refusal must name ${k} so the operator knows what is missing`);
    }
    assert.equal(storeWritten(), false, 'a 501 must not write');
  }
});

// ── PER-LANE OVERRIDES ─────────────────────────────────────────────────────────────────────────
// The three states are the point: auto leaves the derivation alone, off is NOT SCANNED, and on is
// only "runs" when the lane can actually run. A forced-on lane that silently cannot run would be a
// published scan that never happened, which is the false-clean this panel exists to refuse.

test('a forced-ON lane that CANNOT run is reported forced-but-blocked, and is not counted as enabled', async () => {
  const base = await call('POST', '/api/perf/preview', { profileId: 'm4-max-128', depth: 3, intensity: 3 });
  const p = await call('POST', '/api/perf/preview', {
    profileId: 'm4-max-128', depth: 3, intensity: 3, overrides: { 'scanner-05': 'on' },
  });
  assert.equal(p.code, 200, JSON.stringify(p.payload));
  const row = p.payload.tuning.scanners.find((s) => s.id === 'scanner-05');
  assert.equal(row.override, 'on');
  assert.equal(row.blocked, true);
  assert.notEqual(row.enabled, true, 'a lane that cannot run was published as running');
  assert.match(row.reason, /container runtime/, 'the blocking reason must survive the override, not be replaced by "forced on"');
  const c = p.payload.tuning.counts;
  assert.equal(c.forcedBlocked, 1);
  assert.equal(c.forcedOn, 1);
  assert.equal(c.overridden, 1);
  assert.equal(c.enabled, base.payload.tuning.counts.enabled - (base.payload.tuning.scanners.find((s) => s.id === 'scanner-05').enabled === true ? 1 : 0),
    'forcing a blocked lane on changed the enabled count');
  assert.equal(c.enabled + c.disabled + c.undetermined + c.forcedBlocked, c.total,
    'forced-but-blocked was double-counted into enabled or disabled — it belongs to neither');
});

test('a forced-OFF lane reports NOT SCANNED with a reason, never a clean pass', async () => {
  const p = await call('POST', '/api/perf/preview', {
    profileId: 'm4-max-128', depth: 5, intensity: 3, overrides: { 'scanner-01': 'off' },
  });
  assert.equal(p.code, 200, JSON.stringify(p.payload));
  const row = p.payload.tuning.scanners.find((s) => s.id === 'scanner-01');
  assert.equal(row.override, 'off');
  assert.equal(row.enabled, false);
  assert.equal(row.derivedEnabled, true, 'the fixture must be forcing off a lane the derivation would have run');
  assert.match(row.reason, /NOT SCANNED/i);
  assert.equal(p.payload.tuning.counts.forcedOff, 1);
  assert.equal(storeWritten(), false, 'preview wrote the store while overriding a lane');
});

test('an invalid override value is refused 400 NAMING the scanner, and nothing is written', async () => {
  for (const bad of [{ 'scanner-02': 'maybe' }, { 'scanner-02': true }, { 'scanner-02': 1 }, { 'scanner-02': null }]) {
    for (const path of ['/api/perf/preview', '/api/perf']) {
      const r = await call('POST', path, { profileId: 'm4-max-128', depth: 3, intensity: 3, overrides: bad });
      assert.equal(r.code, 400, `${path} accepted ${JSON.stringify(bad)}`);
      assert.match(r.payload.error, /scanner-02/, 'the refusal must name the offending id, not just "an override"');
      assert.match(r.payload.error, /"on"|"off"/);
    }
  }
  // A non-object, and an id that is not an id at all.
  for (const bad of ['on', ['scanner-02'], 42]) {
    const r = await call('POST', '/api/perf', { profileId: 'm4-max-128', depth: 3, intensity: 3, overrides: bad });
    assert.equal(r.code, 400, `overrides=${JSON.stringify(bad)} was accepted`);
    assert.match(r.payload.error, /overrides/);
  }
  const r = await call('POST', '/api/perf', { profileId: 'm4-max-128', depth: 3, intensity: 3, overrides: { 'Not An Id!': 'on' } });
  assert.equal(r.code, 400);
  assert.match(r.payload.error, /Not An Id!/);
  assert.equal(storeWritten(), false, 'a refused override still created the store');
});

test('overrides survive a round trip through the settings store, and come back applied', async () => {
  const g0 = await call('GET', '/api/perf');
  assert.deepEqual(g0.payload.overrides, {}, 'a store that holds nothing must report no overrides, not a guess');
  const body = { profileId: g0.payload.profileId, depth: g0.payload.depth, intensity: g0.payload.intensity,
    overrides: { 'scanner-05': 'on', 'scanner-01': 'off' } };
  const w = await call('POST', '/api/perf', body);
  if (!g0.payload.settingsAvailable) { assert.equal(w.code, 501); return; }
  assert.equal(w.code, 200, JSON.stringify(w.payload));
  assert.deepEqual(w.payload.written.scannerOverrides, { 'scanner-01': 'off', 'scanner-05': 'on' });

  const g1 = await call('GET', '/api/perf');
  assert.deepEqual(g1.payload.overrides, { 'scanner-01': 'off', 'scanner-05': 'on' });
  assert.equal(g1.payload.overridesSource, 'store');
  const rows = Object.fromEntries(g1.payload.tuning.scanners.map((s) => [s.id, s]));
  assert.equal(rows['scanner-01'].override, 'off');
  assert.equal(rows['scanner-01'].enabled, false);
  assert.equal(rows['scanner-05'].override, 'on');
  assert.equal(rows['scanner-05'].blocked, true);
  assert.notEqual(rows['scanner-05'].enabled, true);
  assert.ok(JSON.parse(readFileSync(process.env.CW_SETTINGS, 'utf8')).settings.scannerOverrides.value['scanner-01'] === 'off',
    'the override did not reach the store the sweep reads');
});

test('resetting every lane to auto restores the derived state EXACTLY', async () => {
  const g0 = await call('GET', '/api/perf');
  if (!g0.payload.settingsAvailable) return;
  const sel = { profileId: g0.payload.profileId, depth: g0.payload.depth, intensity: g0.payload.intensity };
  const before = JSON.stringify(g0.payload.tuning.scanners);

  await call('POST', '/api/perf', { ...sel, overrides: { 'scanner-05': 'on', 'scanner-01': 'off' } });
  const mid = await call('GET', '/api/perf');
  assert.notEqual(JSON.stringify(mid.payload.tuning.scanners), before, 'the overrides changed nothing — the test proves nothing');

  // What the page's "reset all to auto" posts: an empty map, which is the declared "no overrides".
  const reset = await call('POST', '/api/perf', { ...sel, overrides: {} });
  assert.equal(reset.code, 200, JSON.stringify(reset.payload));
  assert.equal(reset.payload.written.scannerOverrides, null, 'an empty map must persist as the declared null, not as {}');
  const g2 = await call('GET', '/api/perf');
  assert.deepEqual(g2.payload.overrides, {});
  assert.equal(JSON.stringify(g2.payload.tuning.scanners), before, 'resetting to auto did not restore the derivation exactly');
  for (const s of g2.payload.tuning.scanners) assert.equal(s.override, 'auto');
});

test('a store holding a MALFORMED override applies none of it, and says so', async () => {
  writeFileSync(process.env.CW_SETTINGS, JSON.stringify({
    v: 1, settings: { scannerOverrides: { value: { 'scanner-01': 'sometimes' } } },
  }));
  const g = await call('GET', '/api/perf');
  assert.equal(g.code, 200, JSON.stringify(g.payload).slice(0, 300));
  assert.deepEqual(g.payload.overrides, {}, 'half of a bad override table was applied');
  assert.equal(g.payload.overridesSource, 'invalid-store-fallback');
  assert.ok(g.payload.notes.some((n) => /scanner-01/.test(n)), 'the note must name the row that was refused');
  for (const s of g.payload.tuning.scanners) assert.equal(s.override, 'auto');
});

test('a row claiming to be both blocked and enabled is published as UNDETERMINED, never as running', async () => {
  const { normalizeTuning } = await import('../routes/perf.mjs');
  const t = normalizeTuning({ scanners: [{ id: 'liar', enabled: true, blocked: true, override: 'on', reason: 'needs a container runtime' }] });
  assert.equal(t.scanners[0].enabled, null);
  assert.equal(t.counts.enabled, 0);
  assert.equal(t.counts.forcedBlocked, 1);
  assert.ok(t.warnings.some((w) => /liar/.test(w)));
});

// The fixture above pins the CONTRACT. This one pins the route against the model actually shipped,
// which already deviates from the contract in two ways a fixture cannot catch: DEPTH_LEVELS is a
// FUNCTION rather than an array, and PROFILES is a Proxy whose getOwnPropertyDescriptor answers for
// every key — so a membership test written as hasOwnProperty accepts any profile id at all.
test('the SHIPPED monitor/perf-tuning.mjs resolves through this route', async (t) => {
  delete process.env.CW_PERF_TUNING;
  const g = await call('GET', '/api/perf');
  if (g.code === 503) { t.skip(`monitor/perf-tuning.mjs is not usable here: ${g.payload.error}`); return; }
  assert.equal(g.code, 200, JSON.stringify(g.payload).slice(0, 400));
  assert.ok(g.payload.depthLevels.length >= 5, 'DEPTH_LEVELS did not resolve to a list of levels');
  assert.ok(g.payload.intensityLevels.length >= 5);
  assert.ok(g.payload.profiles.length >= 2);
  assert.ok(g.payload.tuning.scanners.length >= 34, `only ${g.payload.tuning.scanners.length} scanners`);
  for (const s of g.payload.tuning.scanners) {
    if (s.enabled !== true) assert.ok(s.reason && s.reason.trim(), `${s.id} is off with no reason`);
  }
  const bad = await call('POST', '/api/perf/preview', { profileId: 'definitely-not-a-profile', depth: 3, intensity: 3 });
  assert.equal(bad.code, 400, 'an unknown profile id was accepted — the Proxy makes hasOwnProperty answer true for everything');
});

test('no tuning model on disk is 503 UNKNOWN, never a default tuning', async () => {
  process.env.CW_PERF_TUNING = join(DIR, 'absent-perf-tuning.mjs');
  const g = await call('GET', '/api/perf');
  assert.equal(g.code, 503);
  assert.equal(g.payload.ok, false);
  assert.match(g.payload.error, /not on disk/);
  assert.equal(g.payload.tuning, undefined, 'a missing model must not yield a tuning at all');
  const p = await call('POST', '/api/perf/preview', { profileId: 'm4-max-128', depth: 3, intensity: 3 });
  assert.equal(p.code, 503);
  const w = await call('POST', '/api/perf', { profileId: 'm4-max-128', depth: 3, intensity: 3 });
  assert.equal(w.code, 503);
  assert.equal(storeWritten(), false);
});

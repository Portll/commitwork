// monitor/settings.mjs — env > store > default resolved AT CALL TIME, the corruption posture
// (reads degrade and say so, writes refuse), and the validators. Runs entirely on mkdtemp
// fixtures via CW_SETTINGS; never touches ~/.commitwork.
//
// The load-bearing case is 'the call-time proof': this module is imported at the top of THIS FILE,
// which means the import ran before a single one of these env vars existed. A `const X =
// process.env.Y` inside settings.mjs would therefore have frozen the wrong value, and every other
// test here would still pass while proving nothing.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { denyRead, ignoresPermissions, REFUSED_ERRNO } from '../../lib/fs-unreadable.mjs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SETTING_KEYS, SETTINGS_SOURCES, getSetting, getAllSettings, setSettings,
  readSettingsStore, settingsPath, checkCrossKey, resetSettingsWarnings,
} from '../settings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOUR = 60 * 60 * 1000;
const ENV_KEYS = ['CW_SETTINGS', 'CW_SETTINGS_STORE', 'CW_NOW', 'CW_SWEEP_INFLIGHT_MAX_MS', 'CW_SWEEP_KILL_MS', 'CW_SWEEP_CADENCE_MS', 'CW_DOCKER_RESTART_ON_DOWN'];

let saved;
beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  resetSettingsWarnings();
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

/** A store file in a fresh tmpdir. `body` undefined ⇒ the path exists but the file does not. */
function fixture(body) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-settings-'));
  const path = join(dir, 'settings.json');
  if (body !== undefined) writeFileSync(path, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
  return path;
}
const store = (settings) => ({ v: 1, settings });
/** Use a fixture as THE store for this call — always assigned at call time, never at load. */
function use(path) { process.env.CW_SETTINGS = path; return path; }
/** The module warns loudly on a damaged store; a test asserting the RETURN does not need the noise. */
function quiet(fn) {
  const real = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = real; }
}
const bytes = (p) => { try { return readFileSync(p, 'utf8'); } catch (e) { return `ABSENT:${e.code}`; } };

describe('the declared registry', () => {
  test('every key carries what a UI needs, so nobody has to keep a second copy of this list', () => {
    assert.ok(Object.keys(SETTING_KEYS).length >= 3);
    for (const [key, spec] of Object.entries(SETTING_KEYS)) {
      assert.equal(spec.key, key, `${key}: spec.key must match its registry key`);
      assert.equal(typeof spec.label, 'string', `${key}: needs a human label`);
      assert.ok(spec.label.length > 0);
      assert.equal(typeof spec.description, 'string', `${key}: needs a description`);
      assert.ok(spec.description.length > 10);
      assert.match(spec.envVar, /^[A-Z][A-Z0-9_]+$/, `${key}: needs an env shadow name`);
      assert.equal(typeof spec.validate, 'function', `${key}: needs a validator`);
      assert.ok('default' in spec, `${key}: needs a declared default`);
      assert.equal(typeof spec.nullable, 'boolean');
    }
  });

  test('the three sweep knobs carry the defaults and env names the rest of the tree already uses', () => {
    assert.equal(SETTING_KEYS.sweepHangMs.default, 4 * HOUR);
    // liveness.mjs:32 already reads this name — renaming it here would silently fork the knob.
    assert.equal(SETTING_KEYS.sweepHangMs.envVar, 'CW_SWEEP_INFLIGHT_MAX_MS');
    assert.equal(SETTING_KEYS.sweepKillMs.default, null);
    assert.equal(SETTING_KEYS.sweepKillMs.nullable, true);
    assert.equal(SETTING_KEYS.sweepKillMs.envVar, 'CW_SWEEP_KILL_MS');
    assert.equal(SETTING_KEYS.sweepCadenceMs.default, 24 * HOUR);
    assert.equal(SETTING_KEYS.sweepCadenceMs.envVar, 'CW_SWEEP_CADENCE_MS');
    // only sweepKillMs may be null — a nullable hang/cadence would mean "never report"
    assert.equal(SETTING_KEYS.sweepHangMs.nullable, false);
    assert.equal(SETTING_KEYS.sweepCadenceMs.nullable, false);
  });

  test('the source vocabulary is exported, and every source this module emits is in it', () => {
    assert.deepEqual(SETTINGS_SOURCES, ['env', 'store', 'default', 'corrupt-store-fallback']);
  });
});

describe('resolution order — env > store > default', () => {
  test('no store file at all ⇒ defaults, source "default" (ENOENT is the one legitimate absence)', () => {
    use(fixture(undefined));
    const r = getSetting('sweepHangMs');
    assert.equal(r.value, 4 * HOUR);
    assert.equal(r.source, 'default');
    assert.equal(r.storeError, null);
    assert.equal(r.default, 4 * HOUR);
    assert.equal(r.envVar, 'CW_SWEEP_INFLIGHT_MAX_MS');
  });

  test('a stored value beats the default, and source says "store"', () => {
    use(fixture(store({ sweepHangMs: { value: 90 * 60 * 1000, at: '2026-08-01T00:00:00.000Z', by: 'operator' } })));
    const r = getSetting('sweepHangMs');
    assert.equal(r.value, 90 * 60 * 1000);
    assert.equal(r.source, 'store');
    assert.equal(r.setBy, 'operator');
    assert.equal(r.setAt, '2026-08-01T00:00:00.000Z');
  });

  test('an env var beats the store, and source says "env"', () => {
    use(fixture(store({ sweepHangMs: { value: 90 * 60 * 1000 } })));
    process.env.CW_SWEEP_INFLIGHT_MAX_MS = String(30 * 60 * 1000);
    const r = getSetting('sweepHangMs');
    assert.equal(r.value, 30 * 60 * 1000);
    assert.equal(r.source, 'env');
  });

  test('a bare stored scalar is accepted as shorthand for the stamped record form', () => {
    use(fixture(store({ sweepCadenceMs: 6 * HOUR })));
    const r = getSetting('sweepCadenceMs');
    assert.equal(r.value, 6 * HOUR);
    assert.equal(r.source, 'store');
    assert.equal(r.setBy, null);
  });

  test('an env var holding only whitespace is UNSET, not zero', () => {
    use(fixture(store({ sweepCadenceMs: 6 * HOUR })));
    process.env.CW_SWEEP_CADENCE_MS = '   ';
    const r = getSetting('sweepCadenceMs');
    assert.equal(r.value, 6 * HOUR);
    assert.equal(r.source, 'store');
  });

  test('sweepKillMs can be disabled from the env with a word, since "" means unset', () => {
    use(fixture(store({ sweepKillMs: 9 * HOUR })));
    process.env.CW_SWEEP_KILL_MS = 'off';
    const r = getSetting('sweepKillMs');
    assert.equal(r.value, null);
    assert.equal(r.source, 'env');
  });

  test('an INVALID env value is ignored with a note rather than applied or thrown', () => {
    use(fixture(store({ sweepHangMs: 90 * 60 * 1000 })));
    process.env.CW_SWEEP_INFLIGHT_MAX_MS = 'soon';
    const r = quiet(() => getSetting('sweepHangMs'));
    assert.equal(r.value, 90 * 60 * 1000);
    assert.equal(r.source, 'store');
    assert.equal(r.notes.length, 1);
    assert.match(r.notes[0], /CW_SWEEP_INFLIGHT_MAX_MS/);
    assert.match(r.notes[0], /IGNORED/);
  });

  test('getSetting throws on an undeclared key — the registry is a whitelist, not a suggestion', () => {
    use(fixture(undefined));
    assert.throws(() => getSetting('sweepHangMS'), /unknown setting/);
    // a bare SETTING_KEYS[key] resolves these to Object.prototype's members, so an undeclared key
    // arrives as a truthy "spec" and walks past the whitelist
    for (const k of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      assert.throws(() => getSetting(k), /unknown setting/, `${k} was accepted as a declared key`);
    }
  });

  test('a stored "__proto__" key is inert data, not an assignment through Object.prototype', () => {
    use(fixture('{"v":1,"settings":{"__proto__":{"value":{"polluted":true}},"sweepHangMs":{"value":1000}}}'));
    const r = getSetting('sweepHangMs');
    assert.equal(r.value, 1000);
    assert.equal({}.polluted, undefined, 'reading the store polluted Object.prototype');
    // computed key on purpose: a literal `__proto__: 5` is the prototype setter, not an own property
    const w = setSettings({ ['__proto__']: 5 }, { who: 'test' });
    assert.equal(w.ok, false);
    assert.match(w.errors[0], /unknown setting/);
  });
});

describe('THE CALL-TIME PROOF — env is read per call, never captured at module load', () => {
  // settings.mjs was imported at the top of this file. Every env var below is set AFTERWARDS, in a
  // test body. If the module had captured process.env at load, none of these would be observed.
  test('CW_SETTINGS set after import selects the store, and switching it switches the answer', () => {
    const a = fixture(store({ sweepHangMs: 1000 }));
    const b = fixture(store({ sweepHangMs: 2000 }));

    use(a);
    assert.equal(settingsPath(), a);
    assert.equal(getSetting('sweepHangMs').value, 1000, 'first fixture not observed — CW_SETTINGS was read before the test set it');

    use(b);            // same process, same module instance, different answer
    assert.equal(settingsPath(), b);
    assert.equal(getSetting('sweepHangMs').value, 2000, 'the store path was frozen at module load');
  });

  test('a key env var set after import is observed, and UNSETTING it reverts to the store', () => {
    use(fixture(store({ sweepCadenceMs: 6 * HOUR })));
    assert.equal(getSetting('sweepCadenceMs').source, 'store');

    process.env.CW_SWEEP_CADENCE_MS = String(2 * HOUR);
    const shadowed = getSetting('sweepCadenceMs');
    assert.equal(shadowed.value, 2 * HOUR, 'the env var was read at module load, so the test set it too late to matter');
    assert.equal(shadowed.source, 'env');

    delete process.env.CW_SWEEP_CADENCE_MS;
    const reverted = getSetting('sweepCadenceMs');
    assert.equal(reverted.value, 6 * HOUR, 'unsetting the env var had no effect — the value was cached');
    assert.equal(reverted.source, 'store');
  });

  test('the source itself changes with the env, not just the value', () => {
    use(fixture(store({ sweepHangMs: 5000 })));
    const seen = [];
    seen.push(getSetting('sweepHangMs').source);
    process.env.CW_SWEEP_INFLIGHT_MAX_MS = '7000';
    seen.push(getSetting('sweepHangMs').source);
    delete process.env.CW_SWEEP_INFLIGHT_MAX_MS;
    seen.push(getSetting('sweepHangMs').source);
    assert.deepEqual(seen, ['store', 'env', 'store']);
  });

  test('the source file holds no module-level process.env capture', () => {
    const src = readFileSync(join(HERE, '..', 'settings.mjs'), 'utf8');
    const offenders = src.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /^(const|let|var|export const)\s+[A-Za-z_$][\w$]*\s*=\s*[^=]*process\.env/.test(l));
    assert.deepEqual(offenders, [], `a top-level process.env capture defeats every env override: ${JSON.stringify(offenders)}`);
  });
});

describe('corruption posture — reads degrade and SAY SO, writes refuse', () => {
  test('a corrupt store yields defaults with source "corrupt-store-fallback" and does not throw', () => {
    const p = use(fixture('{"settings": {sweepHangMs'));
    const r = quiet(() => getSetting('sweepHangMs'));
    assert.equal(r.value, 4 * HOUR);
    assert.equal(r.source, 'corrupt-store-fallback');
    assert.ok(r.storeError, 'the panel needs the reason, not just the state');
    assert.match(r.storeError, /unparseable/);
    assert.ok(r.storeError.includes(p));
  });

  test('corrupt is DISTINGUISHABLE from absent — the same value, a different state', () => {
    const missing = use(fixture(undefined));
    const absent = getSetting('sweepCadenceMs');
    const corrupt = quiet(() => { use(fixture('not json at all')); return getSetting('sweepCadenceMs'); });
    assert.equal(absent.value, corrupt.value, 'both fall back to the same default…');
    assert.notEqual(absent.source, corrupt.source, '…and must not report the same source');
    assert.equal(absent.source, 'default');
    assert.equal(absent.storeError, null);
    assert.equal(corrupt.source, 'corrupt-store-fallback');
    assert.ok(corrupt.storeError);
    assert.ok(missing.endsWith('settings.json'));
  });

  test('a corrupt store still lets an env var supply the value, and still reports the corruption', () => {
    use(fixture('}{'));
    process.env.CW_SWEEP_HANG = 'ignored';
    process.env.CW_SWEEP_INFLIGHT_MAX_MS = String(11 * 60 * 1000);
    const r = quiet(() => getSetting('sweepHangMs'));
    assert.equal(r.value, 11 * 60 * 1000);
    assert.equal(r.source, 'corrupt-store-fallback', 'the corruption must reach the panel even when env happened to cover it');
    assert.equal(r.effectiveFrom, 'env');
    delete process.env.CW_SWEEP_HANG;
  });

  test('a top-level JSON scalar or array is corrupt, not an empty store', () => {
    for (const body of ['[]', '"hello"', '42', 'null', '{"settings": []}', '{"settings": 3}']) {
      use(fixture(body));
      const r = quiet(() => getSetting('sweepHangMs'));
      assert.equal(r.source, 'corrupt-store-fallback', `${body} was read as an empty store`);
    }
  });

  test('an unreadable store is NOT an empty one — a permission error fails closed to corrupt', { skip: ignoresPermissions() ? 'runs as root' : false }, () => {
    const p = use(fixture(store({ sweepHangMs: 1000 })));
    const _deny = denyRead(p);

    assert.ok(_deny.ok, `could not make the fixture unreadable: ${_deny.why} — the precondition failed, so this test proves nothing`);
    try {
      const r = quiet(() => getSetting('sweepHangMs'));
      assert.equal(r.source, 'corrupt-store-fallback');
      assert.match(r.storeError, /EACCES|EPERM/);
    } finally { _deny.restore(); }
  });

  test('ONE invalid stored value degrades that key only, and the honest keys keep their store values', () => {
    use(fixture(store({ sweepHangMs: -5, sweepCadenceMs: 3 * HOUR })));
    const all = quiet(() => getAllSettings());
    assert.equal(all.settings.sweepHangMs.source, 'corrupt-store-fallback');
    assert.equal(all.settings.sweepHangMs.value, 4 * HOUR);
    assert.match(all.settings.sweepHangMs.storeError, /invalid sweepHangMs/);
    assert.equal(all.settings.sweepCadenceMs.source, 'store');
    assert.equal(all.settings.sweepCadenceMs.value, 3 * HOUR);
  });

  test('setSettings REFUSES over a corrupt store — 503, and the bytes are UNCHANGED', () => {
    const p = use(fixture('{"settings": {"sweepHangMs": '));
    const before = bytes(p);
    const r = quiet(() => setSettings({ sweepCadenceMs: 6 * HOUR }, { who: 'test' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, 503);
    assert.match(r.errors[0], /refusing to write/);
    assert.match(r.errors[0], /unparseable/);
    assert.equal(bytes(p), before, 'a refused write overwrote the store it could not read');
  });

  test('getAllSettings reports ok:false + storeError over a corrupt store, without throwing', () => {
    use(fixture('{{{'));
    const all = quiet(() => getAllSettings());
    assert.equal(all.ok, false);
    assert.ok(all.storeError);
    for (const key of Object.keys(SETTING_KEYS)) {
      assert.equal(all.settings[key].source, 'corrupt-store-fallback');
      assert.equal(all.settings[key].value, SETTING_KEYS[key].default);
    }
  });

  test('readSettingsStore separates absent from unreadable at the source', () => {
    use(fixture(undefined));
    const absent = readSettingsStore();
    assert.equal(absent.present, false);
    assert.equal(absent.error, null);
    assert.deepEqual(absent.values, {});

    use(fixture('nope'));
    const bad = readSettingsStore();
    assert.equal(bad.present, true);
    assert.equal(bad.values, null, 'an unreadable store must never present as {} — that is a silent reset to defaults');
    assert.ok(bad.error);
  });
});

describe('validation', () => {
  const rejected = [
    ['negative', -1],
    ['zero', 0],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '3600000'],
    ['a word', 'four hours'],
    ['true', true],
    ['an object', { ms: 10 }],
    ['an array', [10]],
    ['undefined', undefined],
  ];
  for (const [label, value] of rejected) {
    test(`sweepHangMs rejects ${label}`, () => {
      use(fixture(undefined));
      const r = setSettings({ sweepHangMs: value }, { who: 'test' });
      assert.equal(r.ok, false, `${label} was accepted`);
      assert.equal(r.code, 400);
      assert.match(r.errors[0], /sweepHangMs/);
      assert.match(r.errors[0], /positive finite number/);
    });
  }

  test('null is rejected for sweepHangMs and sweepCadenceMs — only the kill switch is nullable', () => {
    use(fixture(undefined));
    for (const key of ['sweepHangMs', 'sweepCadenceMs']) {
      const r = setSettings({ [key]: null }, { who: 'test' });
      assert.equal(r.ok, false, `${key} accepted null`);
      assert.equal(r.code, 400);
    }
  });

  test('null IS accepted for sweepKillMs and means "never kill"', () => {
    use(fixture(undefined));
    const r = setSettings({ sweepKillMs: null }, { who: 'test' });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(getSetting('sweepKillMs').value, null);
    assert.equal(getSetting('sweepKillMs').source, 'store');
  });

  test('an unknown key is refused with 400 and the declared keys are named', () => {
    const p = use(fixture(undefined));
    const r = setSettings({ sweepHangMS: 1000 }, { who: 'test' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 400);
    assert.match(r.errors[0], /unknown setting/);
    assert.match(r.errors[0], /sweepHangMs/);
    assert.equal(bytes(p), 'ABSENT:ENOENT', 'a refused write created a store');
  });

  test('all problems in one patch are reported together, not one per round trip', () => {
    use(fixture(undefined));
    const r = setSettings({ sweepHangMs: -1, nope: 1 }, { who: 'test' });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 2);
  });
});

describe('the cross-key rule — a kill threshold below the hang threshold kills what it never warned about', () => {
  test('sweepKillMs <= sweepHangMs is refused, and the message names BOTH keys and both numbers', () => {
    const p = use(fixture(store({ sweepHangMs: 4 * HOUR })));
    const before = bytes(p);
    for (const kill of [4 * HOUR, HOUR]) {
      const r = setSettings({ sweepKillMs: kill }, { who: 'test' });
      assert.equal(r.ok, false, `kill=${kill} was accepted below the hang threshold`);
      assert.equal(r.code, 400);
      const msg = r.errors.join(' ');
      assert.match(msg, /sweepKillMs/);
      assert.match(msg, /sweepHangMs/);
      assert.ok(msg.includes(String(kill)), 'the offending value is not in the message');
      assert.ok(msg.includes(String(4 * HOUR)), 'the threshold it violates is not in the message');
    }
    assert.equal(bytes(p), before, 'a refused cross-key write still touched the store');
  });

  test('the rule is checked against the MERGED result, so raising both at once in one patch works', () => {
    use(fixture(store({ sweepHangMs: 4 * HOUR })));
    const r = setSettings({ sweepHangMs: 8 * HOUR, sweepKillMs: 10 * HOUR }, { who: 'test' });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(getSetting('sweepKillMs').value, 10 * HOUR);
  });

  test('lowering hang below an already-stored kill is fine; lowering it under one is what is refused', () => {
    use(fixture(store({ sweepHangMs: 4 * HOUR, sweepKillMs: 6 * HOUR })));
    const bad = setSettings({ sweepHangMs: 9 * HOUR }, { who: 'test' });
    assert.equal(bad.ok, false, 'raising hang above the stored kill inverted the pair silently');
    assert.equal(bad.code, 400);
    const good = setSettings({ sweepHangMs: 5 * HOUR }, { who: 'test' });
    assert.equal(good.ok, true, JSON.stringify(good.errors));
  });

  test('a null kill never conflicts', () => {
    assert.deepEqual(checkCrossKey({ sweepHangMs: 4 * HOUR, sweepKillMs: null }), []);
    assert.equal(checkCrossKey({ sweepHangMs: 4 * HOUR, sweepKillMs: HOUR }).length, 1);
  });

  test('an env/store combination that conflicts is REPORTED on read, never silently overridden', () => {
    use(fixture(store({ sweepKillMs: 5 * HOUR })));
    process.env.CW_SWEEP_INFLIGHT_MAX_MS = String(9 * HOUR);   // env hang now exceeds the stored kill
    const all = getAllSettings();
    assert.equal(all.settings.sweepHangMs.value, 9 * HOUR, 'the operator env var was overridden by a read path');
    assert.equal(all.settings.sweepKillMs.value, 5 * HOUR);
    assert.equal(all.conflicts.length, 1);
    assert.match(all.conflicts[0], /sweepKillMs/);
    assert.match(all.conflicts[0], /sweepHangMs/);
  });
});

describe('writes — attribution, env shadowing, atomicity, determinism', () => {
  test('a successful write is readable back with source "store" and the caller\'s stamp', () => {
    const p = use(fixture(undefined));
    process.env.CW_NOW = '2026-08-23T01:02:03.000Z';
    const r = setSettings({ sweepHangMs: 2 * HOUR }, { who: 'session-abc' });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.code, 200);
    assert.deepEqual(r.written, { sweepHangMs: 2 * HOUR });
    assert.equal(r.at, '2026-08-23T01:02:03.000Z');
    assert.equal(r.who, 'session-abc');

    const back = getSetting('sweepHangMs');
    assert.equal(back.value, 2 * HOUR);
    assert.equal(back.source, 'store');
    assert.equal(back.setBy, 'session-abc');
    assert.equal(back.setAt, '2026-08-23T01:02:03.000Z');
    assert.match(bytes(p), /"updatedBy": "session-abc"/);
  });

  test('who is required, and it is never lifted out of the patch', () => {
    const p = use(fixture(undefined));
    for (const opts of [undefined, {}, { who: '' }, { who: '   ' }, { who: 42 }]) {
      const r = setSettings({ sweepHangMs: HOUR }, opts);
      assert.equal(r.ok, false, `who=${JSON.stringify(opts)} was accepted`);
      assert.equal(r.code, 400);
      assert.match(r.errors[0], /who is required/);
    }
    // a patch that tries to name its own author is just an unknown key
    const forged = setSettings({ sweepHangMs: HOUR, who: 'the-operator' }, { who: 'session-abc' });
    assert.equal(forged.ok, false);
    assert.match(forged.errors.join(' '), /unknown setting "who"/);
    assert.equal(bytes(p), 'ABSENT:ENOENT');
  });

  test('a non-object patch, or an empty one, is refused rather than written as {}', () => {
    use(fixture(undefined));
    for (const patch of [null, undefined, 'sweepHangMs=1', 5, [], {}]) {
      const r = setSettings(patch, { who: 'test' });
      assert.equal(r.ok, false, `patch ${JSON.stringify(patch)} was accepted`);
      assert.equal(r.code, 400);
    }
  });

  test('writing a key that an env var shadows is refused 409, naming the variable', () => {
    const p = use(fixture(undefined));
    process.env.CW_SWEEP_CADENCE_MS = String(2 * HOUR);
    const r = setSettings({ sweepCadenceMs: 6 * HOUR }, { who: 'test' });
    assert.equal(r.ok, false, 'a write that changes nothing observable is the panel lying');
    assert.equal(r.code, 409);
    assert.match(r.errors[0], /CW_SWEEP_CADENCE_MS/);
    assert.equal(bytes(p), 'ABSENT:ENOENT');
  });

  test('an unshadowed key in the same registry is still writable', () => {
    use(fixture(undefined));
    process.env.CW_SWEEP_CADENCE_MS = String(2 * HOUR);
    const r = setSettings({ sweepHangMs: 2 * HOUR }, { who: 'test' });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  test('a second write preserves the keys it did not touch', () => {
    use(fixture(undefined));
    assert.equal(setSettings({ sweepHangMs: 2 * HOUR }, { who: 'a' }).ok, true);
    assert.equal(setSettings({ sweepCadenceMs: 3 * HOUR }, { who: 'b' }).ok, true);
    assert.equal(getSetting('sweepHangMs').value, 2 * HOUR);
    assert.equal(getSetting('sweepHangMs').setBy, 'a');
    assert.equal(getSetting('sweepCadenceMs').value, 3 * HOUR);
    assert.equal(getSetting('sweepCadenceMs').setBy, 'b');
  });

  test('same inputs ⇒ byte-identical output, and no tmp file survives the write', () => {
    const p1 = use(fixture(undefined));
    process.env.CW_NOW = '2026-08-23T00:00:00.000Z';
    setSettings({ sweepCadenceMs: 3 * HOUR, sweepHangMs: 2 * HOUR }, { who: 'det' });
    const first = bytes(p1);

    const p2 = use(fixture(undefined));
    setSettings({ sweepHangMs: 2 * HOUR, sweepCadenceMs: 3 * HOUR }, { who: 'det' }); // patch order differs
    assert.equal(bytes(p2), first, 'the store is not deterministic across patch key order');

    const leftovers = readdirSync(dirname(p2)).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftovers, [], 'an atomic write left its temp file behind');
  });

  test('the store is written 0600 — sweep knobs are operator state, not world-readable config', { skip: process.platform === 'win32' ? 'no POSIX modes' : false }, () => {
    const p = use(fixture(undefined));
    setSettings({ sweepHangMs: HOUR }, { who: 'test' });
    assert.equal(statSync(p).mode & 0o777, 0o600);
  });

  test('CW_NOW is read at CALL time too — two writes in one process can carry different stamps', () => {
    use(fixture(undefined));
    process.env.CW_NOW = '2026-08-23T00:00:00.000Z';
    const a = setSettings({ sweepHangMs: HOUR }, { who: 'test' });
    process.env.CW_NOW = '2026-08-24T00:00:00.000Z';
    const b = setSettings({ sweepCadenceMs: HOUR }, { who: 'test' });
    assert.equal(a.at, '2026-08-23T00:00:00.000Z');
    assert.equal(b.at, '2026-08-24T00:00:00.000Z');
  });

  test('an unparseable CW_NOW falls back to the real clock instead of throwing mid-write', () => {
    use(fixture(undefined));
    process.env.CW_NOW = 'yesterday-ish';
    const r = quiet(() => setSettings({ sweepHangMs: HOUR }, { who: 'test' }));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.ok(Number.isFinite(Date.parse(r.at)));
  });
});

describe('dockerRestartOnDown — the first single-choice key', () => {
  test('the default is do-not-restart: a sweep never changes machine state unasked', () => {
    use(fixture(undefined));
    const r = getSetting('dockerRestartOnDown');
    assert.equal(r.value, 'do-not-restart');
    assert.equal(r.source, 'default');
  });

  test('a STRING env shadow resolves to the string it validated, never to NaN', () => {
    // Regression: fromEnv validated `Number.isNaN(n) ? s : n` but returned `n` unconditionally, so
    // every string-valued env override that PASSED validation was handed back as NaN with source
    // 'env' — an override the operator set and could not recognise in what came back.
    use(fixture(undefined));
    process.env.CW_DOCKER_RESTART_ON_DOWN = 'restart';
    const r = getSetting('dockerRestartOnDown');
    assert.equal(r.value, 'restart', `got ${String(r.value)} (${typeof r.value})`);
    assert.equal(r.source, 'env');
  });

  test('an invalid env value is IGNORED with a note, not applied and not fatal', () => {
    use(fixture(undefined));
    process.env.CW_DOCKER_RESTART_ON_DOWN = 'reboot';
    const r = quiet(() => getSetting('dockerRestartOnDown'));
    assert.equal(r.value, 'do-not-restart');
    assert.equal(r.source, 'default');
    assert.ok(r.notes.some((n) => /IGNORED/.test(n)));
  });

  test('the writer accepts every declared option and refuses anything off the list', () => {
    use(fixture(undefined));
    for (const id of ['restart', 'restart-popup', 'do-not-restart']) {
      const w = setSettings({ dockerRestartOnDown: id }, { who: 'test' });
      assert.equal(w.ok, true, `${id}: ${JSON.stringify(w.errors)}`);
      assert.equal(getSetting('dockerRestartOnDown').value, id);
    }
    const bad = setSettings({ dockerRestartOnDown: 'yes' }, { who: 'test' });
    assert.equal(bad.ok, false);
    assert.match(bad.errors[0], /must be one of/);
  });

  test('every declared option id is one the validator accepts — the panel never offers a doomed choice', () => {
    const spec = SETTING_KEYS.dockerRestartOnDown;
    assert.equal(spec.unit, 'choice', 'single-select is declared through the unit, which the panel branches on');
    for (const o of spec.options) {
      assert.equal(spec.validate(o.id), null, `${o.id} is offered but refused`);
      assert.ok(o.label && o.note, `${o.id} needs a label and a note`);
    }
    assert.equal(spec.default, 'do-not-restart');
  });
});

describe('getAllSettings shape', () => {
  test('every declared key is present with its full provenance record', () => {
    use(fixture(store({ sweepCadenceMs: 3 * HOUR })));
    process.env.CW_SWEEP_INFLIGHT_MAX_MS = String(HOUR);
    const all = getAllSettings();
    assert.equal(all.ok, true);
    assert.equal(all.storeError, null);
    assert.deepEqual(Object.keys(all.settings).sort(), Object.keys(SETTING_KEYS).sort());
    assert.equal(all.settings.sweepHangMs.source, 'env');
    assert.equal(all.settings.sweepCadenceMs.source, 'store');
    assert.equal(all.settings.sweepKillMs.source, 'default');
    for (const rec of Object.values(all.settings)) {
      assert.ok(SETTINGS_SOURCES.includes(rec.source), `${rec.key}: undeclared source ${rec.source}`);
      assert.ok('value' in rec && 'default' in rec && 'envVar' in rec && 'key' in rec);
    }
  });
});

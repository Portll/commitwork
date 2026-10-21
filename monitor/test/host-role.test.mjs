import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHostRole, machineBusy, waitUntilQuiet, cpuBusyFraction, memoryPressure, inputIdleSec,
  onBattery, applySharedPriority, launchdPriorityKeys, SHARED_NICE, parseUnattendedHours, inUnattendedWindow,
} from '../host-role.mjs';
import { getSetting, SETTING_KEYS } from '../settings.mjs';

const quiet = async () => ({ busy: false, reasons: [], unread: [] });
const busy = async () => ({ busy: true, reasons: ['CPU 90% busy (limit 60%)'], unread: [] });
const unread = async () => ({ busy: null, reasons: [], unread: ['os.cpus() returned no processors'] });
const idleFor = (s) => () => ({ value: s });
const auto = { value: 'auto', source: 'default' };
// Every auto probe pins the clock to the afternoon: the unattended window would otherwise make
// these assertions depend on when the suite happens to run.
const day = () => 14;

describe('resolveHostRole', () => {
  test('a declared role wins and probes nothing', async () => {
    const boom = () => { throw new Error('probed'); };
    for (const value of ['shared', 'server']) {
      const r = await resolveHostRole({ setting: { value, source: 'store' }, probe: { localHour: day, inputIdleSec: boom, onBattery: boom, machineBusy: boom } });
      assert.equal(r.role, value);
      assert.equal(r.source, 'store');
      assert.equal(r.signals, null);
    }
  });

  test('auto reaches server only on positive evidence of an idle machine', async () => {
    const r = await resolveHostRole({ setting: auto, env: {}, probe: { localHour: day, inputIdleSec: idleFor(3600), onBattery: () => ({ value: false }), machineBusy: quiet } });
    assert.equal(r.role, 'server');
  });

  test('inside the unattended window recent input is disregarded; battery and load are not', async () => {
    const night = () => 3;
    const typing = { inputIdleSec: idleFor(30), onBattery: () => ({ value: false }), machineBusy: quiet };
    const r = await resolveHostRole({ setting: auto, env: {}, probe: { localHour: night, ...typing } });
    assert.equal(r.role, 'server', 'the default window is 02-07');
    assert.match(r.reasons.join(), /unattended window 02-07 \(CW_UNATTENDED_HOURS\): input 30s ago \(under 900s\) disregarded/);
    assert.equal(r.signals.unattended, true);
    assert.equal((await resolveHostRole({ setting: auto, env: {}, probe: { localHour: night, ...typing, onBattery: () => ({ value: true }) } })).role, 'shared');
    assert.equal((await resolveHostRole({ setting: auto, env: {}, probe: { localHour: night, ...typing, machineBusy: busy } })).role, 'shared');
    assert.equal((await resolveHostRole({ setting: auto, env: {}, probe: { localHour: () => 7, ...typing } })).role, 'shared', 'the end hour is exclusive');
    assert.equal((await resolveHostRole({ setting: auto, env: { CW_UNATTENDED_HOURS: 'off' }, probe: { localHour: night, ...typing } })).role, 'shared', 'off disables the window');
    assert.equal((await resolveHostRole({ setting: auto, env: { CW_UNATTENDED_HOURS: '22-05' }, probe: { localHour: () => 23, ...typing } })).role, 'server', 'a window may wrap midnight');
    assert.equal((await resolveHostRole({ setting: auto, env: { CW_UNATTENDED_HOURS: '22-05' }, probe: { localHour: () => 12, ...typing } })).role, 'shared');
  });

  test('the unattended window parses strictly', () => {
    assert.deepEqual(parseUnattendedHours('02-07'), { from: 2, to: 7 });
    assert.deepEqual(parseUnattendedHours('22-05'), { from: 22, to: 5 });
    for (const bad of ['', 'off', '2', '25-07', '07-07', '2-25', 'night']) assert.equal(parseUnattendedHours(bad), null, bad);
    assert.equal(inUnattendedWindow(3, null), false);
    assert.equal(inUnattendedWindow(0, { from: 22, to: 5 }), true);
    assert.equal(inUnattendedWindow(5, { from: 22, to: 5 }), false);
  });

  test('auto is shared while someone is at the machine', async () => {
    const r = await resolveHostRole({ setting: auto, env: {}, probe: { localHour: day, inputIdleSec: idleFor(30), onBattery: () => ({ value: false }), machineBusy: quiet } });
    assert.equal(r.role, 'shared');
    assert.match(r.reasons.join(), /input 30s ago/);
  });

  test('auto is shared on battery and when the machine is busy', async () => {
    const onBat = await resolveHostRole({ setting: auto, env: {}, probe: { localHour: day, inputIdleSec: idleFor(3600), onBattery: () => ({ value: true }), machineBusy: quiet } });
    assert.equal(onBat.role, 'shared');
    const loaded = await resolveHostRole({ setting: auto, env: {}, probe: { localHour: day, inputIdleSec: idleFor(3600), onBattery: () => ({ value: false }), machineBusy: busy } });
    assert.equal(loaded.role, 'shared');
    assert.match(loaded.reasons.join(), /CPU 90%/);
  });

  test('an unreadable signal resolves to shared and names what could not be read', async () => {
    const noPresence = await resolveHostRole({ setting: auto, env: {}, probe: { localHour: day, inputIdleSec: () => ({ value: null, why: 'no input-idle reading on linux' }), onBattery: () => ({ value: null }), machineBusy: quiet } });
    assert.equal(noPresence.role, 'shared');
    assert.match(noPresence.reasons.join(), /presence unreadable \(no input-idle reading on linux\)/);
    const noLoad = await resolveHostRole({ setting: auto, env: {}, probe: { localHour: day, inputIdleSec: idleFor(3600), onBattery: () => ({ value: false }), machineBusy: unread } });
    assert.equal(noLoad.role, 'shared');
    assert.match(noLoad.reasons.join(), /load undetermined/);
  });

  test('unknown power is not evidence of battery', async () => {
    const r = await resolveHostRole({ setting: auto, env: {}, probe: { localHour: day, inputIdleSec: idleFor(3600), onBattery: () => ({ value: null, why: 'x' }), machineBusy: quiet } });
    assert.equal(r.role, 'server');
  });

  test('the presence threshold is env-overridable at call time', async () => {
    const probe = { inputIdleSec: idleFor(120), onBattery: () => ({ value: false }), machineBusy: quiet };
    assert.equal((await resolveHostRole({ setting: auto, env: {}, probe })).role, 'shared');
    assert.equal((await resolveHostRole({ setting: auto, env: { CW_HOST_PRESENCE_IDLE_S: '60' }, probe })).role, 'server');
  });
});

describe('machineBusy', () => {
  const sample = (v) => async () => ({ value: v });
  test('busy on CPU over the limit or memory pressure, quiet otherwise', async () => {
    assert.equal((await machineBusy({ env: {}, probe: { cpuBusyFraction: sample(0.2), memoryPressure: () => ({ value: 'normal' }) } })).busy, false);
    assert.equal((await machineBusy({ env: {}, probe: { cpuBusyFraction: sample(0.7), memoryPressure: () => ({ value: 'normal' }) } })).busy, true);
    assert.equal((await machineBusy({ env: {}, probe: { cpuBusyFraction: sample(0.2), memoryPressure: () => ({ value: 'warn' }) } })).busy, true);
    assert.equal((await machineBusy({ env: { CW_HOST_BUSY_CPU: '0.8' }, probe: { cpuBusyFraction: sample(0.7), memoryPressure: () => ({ value: 'normal' }) } })).busy, false);
  });

  test('a busy signal outranks an unreadable one; an unreadable one is never quiet', async () => {
    const both = await machineBusy({ env: {}, probe: { cpuBusyFraction: sample(0.9), memoryPressure: () => ({ value: null, why: 'nope' }) } });
    assert.equal(both.busy, true);
    const none = await machineBusy({ env: {}, probe: { cpuBusyFraction: async () => ({ value: null, why: 'no cpus' }), memoryPressure: () => ({ value: 'normal' }) } });
    assert.equal(none.busy, null);
    assert.deepEqual(none.unread, ['no cpus']);
  });
});

describe('probes', () => {
  const cpu = (user, idle) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } });
  test('cpuBusyFraction is the busy share of the CPU time that elapsed', async () => {
    const frames = [[cpu(100, 100), cpu(100, 100)], [cpu(175, 125), cpu(175, 125)]];
    const r = await cpuBusyFraction({ ms: 0, cpus: () => frames.shift(), sleep: async () => {} });
    assert.equal(r.value, 0.75);
  });

  test('cpuBusyFraction with no processors is undetermined, not idle', async () => {
    assert.equal((await cpuBusyFraction({ cpus: () => [], sleep: async () => {} })).value, null);
  });

  test('memoryPressure reads darwin levels and linux PSI', () => {
    assert.equal(memoryPressure({ os: 'darwin', run: () => '1\n' }).value, 'normal');
    assert.equal(memoryPressure({ os: 'darwin', run: () => '4\n' }).value, 'critical');
    assert.equal(memoryPressure({ os: 'darwin', run: () => '9\n' }).value, null);
    assert.equal(memoryPressure({ os: 'linux', read: () => 'some avg10=12.50 avg60=1 avg300=0 total=1\nfull avg10=0' }).value, 'warn');
    assert.equal(memoryPressure({ os: 'linux', read: () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); } }).value, null);
    assert.equal(memoryPressure({ os: 'win32' }).value, null);
  });

  test('inputIdleSec and onBattery parse darwin output and refuse to guess elsewhere', () => {
    assert.equal(inputIdleSec({ os: 'darwin', run: () => '  |   "HIDIdleTime" = 154301583000\n' }).value, 154);
    assert.equal(inputIdleSec({ os: 'darwin', run: () => '' }).value, null);
    assert.equal(inputIdleSec({ os: 'linux' }).value, null);
    assert.equal(onBattery({ os: 'darwin', run: () => "Now drawing from 'Battery Power'\n" }).value, true);
    assert.equal(onBattery({ os: 'darwin', run: () => "Now drawing from 'AC Power'\n" }).value, false);
    assert.equal(onBattery({ os: 'darwin', run: () => { throw new Error('no pmset'); } }).value, null);
  });
});

describe('waitUntilQuiet', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms) => { t += ms; } };
  };

  test('returns at once on a quiet machine', async () => {
    const c = clock();
    const w = await waitUntilQuiet({ env: {}, busy: quiet, ...c });
    assert.equal(w.outcome, 'quiet');
    assert.equal(w.waitedMs, 0);
    assert.equal(w.polls, 1);
  });

  test('waits through busy polls until quiet, announcing once', async () => {
    const c = clock();
    const seq = [busy, busy, quiet];
    let announced = 0;
    const w = await waitUntilQuiet({ env: {}, pollMs: 1000, busy: (o) => seq.shift()(o), onWait: () => announced++, ...c });
    assert.equal(w.outcome, 'quiet');
    assert.equal(w.waitedMs, 2000);
    assert.equal(w.polls, 3);
    assert.equal(announced, 1);
  });

  test('gives up at the deadline and says it is proceeding contended', async () => {
    const c = clock();
    const w = await waitUntilQuiet({ env: {}, maxWaitMs: 5000, pollMs: 2000, busy, ...c });
    assert.equal(w.outcome, 'timed-out');
    assert.equal(w.waitedMs, 5000);
  });

  test('an unmeasurable machine proceeds rather than stalling forever', async () => {
    const w = await waitUntilQuiet({ env: {}, busy: unread, ...clock() });
    assert.equal(w.outcome, 'undetermined');
  });
});

describe('priority', () => {
  test('applySharedPriority lowers priority and never raises it', () => {
    let set = null;
    assert.deepEqual(applySharedPriority({ get: () => 0, set: (n) => { set = n; } }), { applied: true, from: 0, to: SHARED_NICE });
    assert.equal(set, SHARED_NICE);
    set = null;
    assert.equal(applySharedPriority({ get: () => 15, set: (n) => { set = n; } }).applied, false);
    assert.equal(set, null);
    const failed = applySharedPriority({ get: () => 0, set: () => { throw Object.assign(new Error('x'), { code: 'EACCES' }); } });
    assert.equal(failed.applied, false);
    assert.match(failed.why, /EACCES/);
  });

  test('launchd keys: background only when shared is declared, nothing for server', () => {
    assert.match(launchdPriorityKeys('shared'), /ProcessType<\/key><string>Background/);
    assert.match(launchdPriorityKeys('auto'), /Nice<\/key><integer>10/);
    assert.doesNotMatch(launchdPriorityKeys('auto'), /ProcessType/);
    assert.equal(launchdPriorityKeys('server'), '');
  });
});

describe('hostRole setting', () => {
  test('declared, defaults to auto, and validates its options', () => {
    const spec = SETTING_KEYS.hostRole;
    assert.equal(spec.default, 'auto');
    assert.deepEqual(spec.options.map((o) => o.id), ['auto', 'shared', 'server']);
    for (const o of spec.options) assert.equal(spec.validate(o.id), null);
    assert.ok(spec.validate('dedicated'));
  });

  test('CW_HOST_ROLE shadows the store', () => {
    const prev = process.env.CW_HOST_ROLE;
    try {
      process.env.CW_HOST_ROLE = 'server';
      const s = getSetting('hostRole', { store: { values: {}, records: {}, path: 'x' } });
      assert.equal(s.value, 'server');
      assert.equal(s.source, 'env');
    } finally {
      if (prev === undefined) delete process.env.CW_HOST_ROLE; else process.env.CW_HOST_ROLE = prev;
    }
  });
});

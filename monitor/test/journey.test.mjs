// A step is done because the record says so, never because a flag was stored. An input that could
// not be read is 'unreadable', never step 0 and never done. Optional steps can be skipped and say
// so; account-gated tools are credentials, not missing scanners; lane status is never the first
// run's result. The stored record is validated to its two keys and the known step ids.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveJourney, validSetupJourney, JOURNEY_STEPS, JOURNEY_STEP_IDS } from '../journey.mjs';

const base = () => ({
  users: 1,
  registry: { example: false, unreadable: null, areas: 1, projects: 2, repos: 2 },
  scanners: { tools: [{ name: 'semgrep', state: 'present', blocks: ['sast'] }, { name: 'trufflehog', state: 'present', blocks: ['secrets'] }] },
  credentials: { rows: [{ name: 'GITHUB_TOKEN', resolvable: true, blocks: ['actions'] }] },
  firstRun: { areasWithRollup: 1, areas: 1, sweepRunning: false, reportDirSet: true },
  schedule: { perArea: [{ slug: 'a', state: 'scheduled', paused: false }] },
  notifications: { dailyPresent: true },
  store: { value: { acknowledged: ['personalise', 'palette'] }, error: null },
  flags: { palette: true },
  operator: true,
});
const step = (j, id) => j.steps.find((s) => s.id === id);

describe('declaration', () => {
  test('nine steps with unique ids, each carrying optional and operator-only flags', () => {
    assert.equal(JOURNEY_STEPS.length, 9);
    assert.equal(new Set(JOURNEY_STEP_IDS).size, 9);
    for (const s of JOURNEY_STEPS) { assert.equal(typeof s.optional, 'boolean'); assert.equal(typeof s.operatorOnly, 'boolean'); }
    assert.deepEqual(JOURNEY_STEPS.filter((s) => !s.optional).map((s) => s.id), ['account', 'project', 'scanners', 'firstrun', 'schedule']);
  });
});

describe('derivation', () => {
  test('a fully set-up box is complete and says so from records', () => {
    const j = deriveJourney(base());
    assert.equal(j.complete, true);
    assert.deepEqual(j.progress, { done: 9, total: 9, unreadable: [] });
    assert.equal(j.storeState, 'present');
    assert.equal(step(j, 'project').detail, '2 repositories across 1 area');
  });

  test('the example registry is a todo that names init, not a done with zero projects', () => {
    const j = deriveJourney({ ...base(), registry: { example: true, unreadable: null, areas: 1, projects: 1, repos: 1 } });
    assert.equal(step(j, 'project').state, 'todo');
    assert.match(step(j, 'project').detail, /EXAMPLE registry/);
    assert.match(step(j, 'project').cli, /init --root/);
  });

  test('an unreadable input is unreadable, counted in progress.unreadable, never done and never step 0', () => {
    const j = deriveJourney({ ...base(), users: null, registry: { unreadable: 'EACCES' }, scanners: { unreadable: 'EACCES' }, credentials: { unreadable: 'EACCES' }, schedule: null, notifications: { dailyPresent: null } });
    for (const id of ['account', 'project', 'scanners', 'credentials', 'schedule', 'notifications']) assert.equal(step(j, id).state, 'unreadable', id);
    assert.deepEqual(j.progress.unreadable.sort(), ['account', 'credentials', 'notifications', 'project', 'scanners', 'schedule']);
    assert.equal(j.complete, false);
    assert.equal(step(j, 'personalise').state, 'done', 'acknowledgements still read while other inputs are unreadable');
  });

  test('an unreadable store is reported and reads as nothing acknowledged, not as a reset', () => {
    const j = deriveJourney({ ...base(), store: { value: null, error: 'settings store is not JSON' } });
    assert.equal(j.storeState, 'unreadable');
    assert.match(j.storeError, /not JSON/);
    assert.equal(step(j, 'personalise').state, 'todo');
    assert.equal(j.dismissed, false);
  });

  test('scanner readiness: missing, installed-but-not-on-PATH and account-gated are three different things', () => {
    const j = deriveJourney({ ...base(), scanners: { tools: [
      { name: 'semgrep', state: 'present', blocks: ['sast'] },
      { name: 'gitleaks', state: 'missing', blocks: ['secrets'] },
      { name: 'ruff', state: 'installed-not-on-path', at: '/opt/tools/bin/ruff', blocks: ['lint-python'] },
      { name: 'socket', state: 'missing', blocks: ['socket'], requiresAccount: { vendor: 'Socket (socket.dev)', needs: ['an account', 'an org', 'SOCKET_CLI_API_TOKEN'] } },
    ] } });
    const s = step(j, 'scanners');
    assert.equal(s.state, 'todo');
    assert.deepEqual(s.counts, { present: 1, missing: 1, installedNotOnPath: 1, accountGated: 1 });
    assert.deepEqual(s.missing, [{ name: 'gitleaks', blocks: ['secrets'] }]);
    assert.equal(s.installedNotOnPath[0].at, '/opt/tools/bin/ruff');
    assert.match(s.detail, /minutes, not seconds/);
    const skipped = deriveJourney({ ...base(), scanners: { tools: [{ name: 'gitleaks', state: 'missing', blocks: ['secrets'] }, { name: 'socket', state: 'present', blocks: ['socket'], requiresAccount: { vendor: 'Socket (socket.dev)', needs: ['an account'] } }] }, store: { value: { acknowledged: ['scanners'] }, error: null } });
    assert.equal(step(skipped, 'scanners').state, 'skipped');
    assert.match(step(skipped, 'scanners').detail, /report not scanned/);
    assert.deepEqual(step(skipped, 'credentials').accountGated, [{ tool: 'socket', vendor: 'Socket (socket.dev)', needs: ['an account'], state: 'present' }]);
    assert.equal(step(skipped, 'scanners').counts.missing, 1, 'the account-gated tool is not a missing scanner');
  });

  test('the palette step is unavailable when its flag is off and completes on acknowledgement', () => {
    const off = deriveJourney({ ...base(), flags: { palette: false }, store: { value: null, error: null } });
    assert.equal(step(off, 'palette').state, 'unavailable');
    assert.equal(off.progress.total, 8, 'an unavailable step is not counted against the operator');
    const on = deriveJourney({ ...base(), store: { value: { acknowledged: ['palette'] }, error: null } });
    assert.equal(step(on, 'palette').state, 'done');
  });

  test('first run: a running sweep is running, a rollup is done, no rollup names CW_REPORT_DIR when unset', () => {
    assert.equal(step(deriveJourney({ ...base(), firstRun: { areasWithRollup: 0, areas: 1, sweepRunning: true, reportDirSet: true } }), 'firstrun').state, 'running');
    const none = step(deriveJourney({ ...base(), firstRun: { areasWithRollup: 0, areas: 1, sweepRunning: false, reportDirSet: false } }), 'firstrun');
    assert.equal(none.state, 'todo');
    assert.match(none.detail, /CW_REPORT_DIR is unset/);
    assert.equal(none.reportDirSet, false);
    assert.match(step(deriveJourney(base()), 'firstrun').detail, /not a lane's pass/);
  });

  test('schedule: done only when every unpaused area is scheduled; paused areas do not count', () => {
    const j = deriveJourney({ ...base(), schedule: { perArea: [{ slug: 'a', state: 'scheduled', paused: false }, { slug: 'b', state: 'absent', paused: false }, { slug: 'c', state: 'absent', paused: true }] } });
    assert.equal(step(j, 'schedule').state, 'todo');
    assert.deepEqual(step(j, 'schedule').counts, { scheduled: 1, absent: 1 });
    assert.match(step(j, 'schedule').detail, /1 of 2 areas scheduled.*yours to run/);
    const ok = deriveJourney({ ...base(), schedule: { perArea: [{ slug: 'a', state: 'scheduled', paused: false }, { slug: 'c', state: 'absent', paused: true }] } });
    assert.equal(step(ok, 'schedule').state, 'done');
  });

  test('operator-only todo steps are marked offPort when the caller is not on the operator port', () => {
    const j = deriveJourney({ ...base(), operator: false, users: 0, scanners: { tools: [{ name: 'x', state: 'missing', blocks: [] }] } });
    assert.equal(step(j, 'account').offPort, true);
    assert.equal(step(j, 'scanners').offPort, true);
    assert.equal(step(j, 'project').offPort, undefined, 'adding a project is not operator-only');
    const on = deriveJourney({ ...base(), operator: true, users: 0 });
    assert.equal(step(on, 'account').offPort, undefined);
  });

  test('dismissed travels from the store', () => {
    assert.equal(deriveJourney({ ...base(), store: { value: { dismissed: true }, error: null } }).dismissed, true);
  });
});

describe('the stored record', () => {
  test('accepts null, the empty object, and the two declared keys with known ids', () => {
    assert.equal(validSetupJourney(null), null);
    assert.equal(validSetupJourney({}), null);
    assert.equal(validSetupJourney({ dismissed: true, acknowledged: ['palette', 'scanners'] }), null);
  });
  test('refuses other shapes, unknown keys, non-boolean dismissed and unknown step ids', () => {
    assert.match(validSetupJourney([]), /must be an object/);
    assert.match(validSetupJourney('x'), /must be an object/);
    assert.match(validSetupJourney({ done: true }), /unknown key 'done'/);
    assert.match(validSetupJourney({ dismissed: 'yes' }), /dismissed must be/);
    assert.match(validSetupJourney({ acknowledged: 'palette' }), /must be an array/);
    assert.match(validSetupJourney({ acknowledged: ['nope'] }), /unknown step 'nope'/);
  });
});

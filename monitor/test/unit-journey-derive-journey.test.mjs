// Onboarding step states and progress from probed inputs (monitor/journey.mjs deriveJourney).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveJourney } from '../journey.mjs';

const base = (over = {}) => ({
  users: 1,
  registry: { areas: 1, projects: 1, repos: 1 },
  scanners: { tools: [] },
  credentials: { rows: [] },
  firstRun: { areasWithRollup: 1, areas: 1 },
  schedule: { perArea: [{ slug: 'a', state: 'scheduled', paused: false }] },
  notifications: { dailyPresent: true },
  ...over,
});
const step = (id, over) => deriveJourney(base(over)).steps.find((s) => s.id === id);
const brief = (id, over) => { const s = step(id, over); return [s.state, s.detail, s.counts]; };
const acked = (...acknowledged) => ({ value: { acknowledged }, error: null });

test('the account step is done from one user, todo at zero and unreadable when null', () => {
  assert.deepEqual(brief('account', { users: 1 }), ['done', '1 account', {}]);
  assert.deepEqual(brief('account', { users: 2 }), ['done', '2 accounts', {}]);
  assert.deepEqual(brief('account', { users: 0 }), ['todo', 'no account yet; the first one is created on the operator port', {}]);
  assert.deepEqual(brief('account', { users: null }), ['unreadable', 'the users store could not be read', {}]);
});

test('the store supplies acknowledgements and dismissal, and a missing store reads as absent', () => {
  const summary = (store) => { const r = deriveJourney(base({ store })); return [r.storeState, r.storeError, r.dismissed, r.steps[1].state, r.steps[2].state]; };
  assert.deepEqual(summary(undefined), ['absent', null, false, 'todo', 'todo']);
  assert.deepEqual(summary({ value: { acknowledged: ['personalise', 'palette'], dismissed: true }, error: null }), ['present', null, true, 'done', 'done']);
  assert.deepEqual(summary({ value: { acknowledged: 'personalise' }, error: null }), ['present', null, false, 'todo', 'todo']);
  assert.deepEqual(summary({ value: null, error: 'bad json' }), ['unreadable', 'bad json', false, 'todo', 'todo']);
  assert.deepEqual(brief('personalise'), ['todo', 'theme, colour-vision palette and Learning mode live in the account menu', {}]);
  assert.deepEqual(brief('palette'), ['todo', 'press Cmd+K or Ctrl+K and open any view; this step completes on the first navigation', {}]);
});

test('the project step needs a readable, non-example registry holding an area or project', () => {
  const project = (registry) => brief('project', { registry });
  assert.deepEqual(project(undefined), ['unreadable', 'the registry could not be read', {}]);
  assert.deepEqual(project({ unreadable: 'perm denied' }), ['unreadable', 'the registry could not be read (perm denied)', {}]);
  assert.deepEqual(project({ example: true, areas: 3 }), ['todo', 'the panel is reading the EXAMPLE registry; run init to create the private store (safe to re-run)', { areas: 0, projects: 0 }]);
  assert.deepEqual(project({ areas: 0, projects: [] }), ['todo', 'the registry has no project or area yet', {}]);
  assert.deepEqual(project({ areas: 1, projects: 1, repos: 1 }), ['done', '1 repository across 1 area', { areas: 1, projects: 1, repos: 1 }]);
  assert.deepEqual(project({ areas: ['a', 'b'], projects: [], repos: ['r', 's', 't'] }), ['done', '3 repositories across 2 areas', { areas: 2, projects: 0, repos: 3 }]);
  assert.deepEqual(project({ areas: 0, projects: 1, repos: 0 }), ['done', '0 repositories across 0 areas', { areas: 0, projects: 1, repos: 0 }]);
  assert.deepEqual(project({ areas: 1, projects: 0, repos: 2 }), ['done', '2 repositories across 1 area', { areas: 1, projects: 0, repos: 2 }]);
  assert.deepEqual(project({ areas: 2, projects: 0, repos: 1 }), ['done', '1 repository across 2 areas', { areas: 2, projects: 0, repos: 1 }]);
});

test('the scanner step sorts tools by state and keeps account-gated tools out of missing', () => {
  const tools = [{ name: 'p1', state: 'present' }, { name: 'p2', state: 'present' }, { name: 'p3', state: 'present' },
    { name: 'm1', state: 'missing', blocks: ['lane-a'] }, { name: 'm2', state: 'missing' }, { name: 'o1', state: 'installed-not-on-path', at: '/opt/o1', blocks: ['lane-b'] },
    { name: 'g1', state: 'missing', requiresAccount: { vendor: 'acme', needs: ['token'] } }];
  const scanners = (list, over) => brief('scanners', { scanners: { tools: list }, ...over });
  const counts = { present: 3, missing: 2, installedNotOnPath: 1, accountGated: 1 };
  assert.deepEqual(scanners(tools), ['todo', '3 on PATH \u00b7 2 missing \u00b7 1 installed but not on PATH; setup takes minutes, not seconds', counts]);
  const listed = step('scanners', { scanners: { tools } });
  assert.deepEqual(listed.missing, [{ name: 'm1', blocks: ['lane-a'] }, { name: 'm2', blocks: [] }]);
  assert.deepEqual(listed.installedNotOnPath, [{ name: 'o1', at: '/opt/o1', blocks: ['lane-b'] }]);
  assert.deepEqual(scanners(tools, { store: acked('scanners') }), ['skipped', 'running with what is installed: 2 missing, 1 installed but not on PATH; their lanes will report not scanned', counts]);
  const bare = [{ name: 'o2', state: 'installed-not-on-path' }];
  assert.deepEqual(scanners(bare), ['todo', '0 on PATH \u00b7 0 missing \u00b7 1 installed but not on PATH; setup takes minutes, not seconds', { present: 0, missing: 0, installedNotOnPath: 1, accountGated: 0 }]);
  assert.deepEqual(step('scanners', { scanners: { tools: bare } }).installedNotOnPath, [{ name: 'o2', at: null, blocks: [] }]);
  assert.deepEqual(scanners([tools[0], tools[6]]), ['done', '1 tools on PATH', { present: 1, missing: 0, installedNotOnPath: 0, accountGated: 1 }]);
  assert.deepEqual(scanners([{ name: 'x', state: 'missing', requiresAccount: 'yes' }])[2], { present: 0, missing: 1, installedNotOnPath: 0, accountGated: 0 });
  assert.deepEqual(brief('scanners', { scanners: {} }), ['done', '0 tools on PATH', { present: 0, missing: 0, installedNotOnPath: 0, accountGated: 0 }]);
  assert.deepEqual(brief('scanners', { scanners: undefined }), ['unreadable', 'the lane manifest could not be read', {}]);
  assert.deepEqual(brief('scanners', { scanners: { unreadable: 'bad yaml' } }), ['unreadable', 'the lane manifest could not be read (bad yaml)', {}]);
});

test('the credentials step reports ref resolution and lists account-gated tools', () => {
  const creds = (credentials, over) => brief('credentials', { credentials, ...over });
  const rows = [{ name: 'A', resolvable: true }, { name: 'B', resolvable: false, blocks: ['lane-c'] }, { name: 'C', resolvable: false }];
  assert.deepEqual(creds(undefined), ['unreadable', 'the credential refs could not be read', {}]);
  assert.deepEqual(creds({ unreadable: 'no file' }), ['unreadable', 'the credential refs could not be read (no file)', {}]);
  assert.deepEqual(creds({}), ['todo', 'no credential refs recorded; presence only is ever shown here', { declared: 0, resolvable: 0, missing: 0 }]);
  assert.deepEqual(creds({ rows: rows.slice(0, 1) }), ['done', '1 credential ref resolve', { declared: 1, resolvable: 1, missing: 0 }]);
  assert.deepEqual(creds({ rows: [rows[0], { name: 'D' }] }), ['done', '2 credential refs resolve', { declared: 2, resolvable: 2, missing: 0 }]);
  assert.deepEqual(creds({ rows }), ['todo', '2 of 3 refs do not resolve', { declared: 3, resolvable: 1, missing: 2 }]);
  assert.deepEqual(step('credentials', { credentials: { rows } }).missing, [{ name: 'B', blocks: ['lane-c'] }, { name: 'C', blocks: [] }]);
  assert.deepEqual(creds({ rows }, { store: acked('credentials') }), ['skipped', 'skipped; checks that need a credential report not scanned', { declared: 3, resolvable: 1, missing: 2 }]);
  const tools = [{ name: 'g1', state: 'missing', requiresAccount: { vendor: 'acme', needs: ['token'] } },
    { name: 'g2', state: 'present', requiresAccount: { needs: 'token' } }, { name: 'p1', state: 'present' }];
  assert.deepEqual(step('credentials', { scanners: { tools } }).accountGated, [{ tool: 'g1', vendor: 'acme', needs: ['token'], state: 'missing' }, { tool: 'g2', vendor: null, needs: [], state: 'present' }]);
  assert.deepEqual(step('credentials', { scanners: undefined }).accountGated, []);
});

test('the first run step is done from one area with a rollup and running while a sweep runs', () => {
  const first = (firstRun) => brief('firstrun', { firstRun });
  assert.deepEqual(first({ areasWithRollup: 1, areas: 3 }), ['done', "1 of 3 areas have a rollup; read the feed's counts, not a lane's pass", { areasWithRollup: 1, areas: 3 }]);
  assert.deepEqual(first({ areasWithRollup: ['a', 'b'], areas: ['a', 'b'] }), ['done', "2 of 2 areas have a rollup; read the feed's counts, not a lane's pass", { areasWithRollup: 2, areas: 2 }]);
  assert.deepEqual(first({ areasWithRollup: 0, areas: 2 }), ['todo', 'no area has a rollup yet', { areasWithRollup: 0, areas: 2 }]);
  assert.deepEqual(first({ areas: 2, reportDirSet: false }), ['todo', 'no area has a rollup yet; CW_REPORT_DIR is unset, so every CLI run warns and writes to a temp dir', { areasWithRollup: 0, areas: 2 }]);
  assert.deepEqual(first({ sweepRunning: true, areasWithRollup: 2, areas: 2 }), ['running', 'a sweep is running now; the feed shows its findings when it lands', { areasWithRollup: 2, areas: 2 }]);
  assert.deepEqual(first(undefined), ['todo', 'no area has a rollup yet', { areasWithRollup: 0, areas: 0 }]);
  assert.equal(step('firstrun', { firstRun: { reportDirSet: false } }).reportDirSet, false);
  assert.equal(step('firstrun', { firstRun: undefined }).reportDirSet, true);
});

test('the schedule step counts unpaused areas by state and needs all of them scheduled', () => {
  const schedule = (perArea) => brief('schedule', { schedule: { perArea } });
  const scheduled = { slug: 'a', state: 'scheduled' }, stale = { slug: 'b', state: 'stale' }, paused = { slug: 'c', state: 'stale', paused: true };
  const plan = 'the plan is generated here, loading it into launchd is yours to run';
  assert.deepEqual(brief('schedule', { schedule: undefined }), ['unreadable', 'the launch agents could not be read', {}]);
  assert.deepEqual(schedule('nope'), ['unreadable', 'the launch agents could not be read', {}]);
  assert.deepEqual(schedule([paused]), ['todo', 'no unpaused area to schedule', {}]);
  assert.deepEqual(schedule([scheduled, paused]), ['done', '1 area scheduled', { scheduled: 1 }]);
  assert.deepEqual(schedule([scheduled, scheduled]), ['done', '2 areas scheduled', { scheduled: 2 }]);
  assert.deepEqual(schedule([scheduled, scheduled, stale]), ['todo', `2 of 3 areas scheduled; ${plan}`, { scheduled: 2, stale: 1 }]);
  assert.deepEqual(schedule([stale]), ['todo', `0 of 1 areas scheduled; ${plan}`, { stale: 1 }]);
  assert.deepEqual(step('schedule', { schedule: { perArea: [scheduled, paused] } }).perArea, [{ slug: 'a', state: 'scheduled', paused: false }, { slug: 'c', state: 'stale', paused: true }]);
});

test('the notifications step follows the daily config unless acknowledged as skipped', () => {
  const daily = (dailyPresent, over) => brief('notifications', { notifications: { dailyPresent }, ...over });
  assert.deepEqual(daily(true), ['done', 'daily.json present', {}]);
  assert.deepEqual(daily(false), ['todo', 'no daily.json; the daily report and digest have nowhere to go', {}]);
  assert.deepEqual(daily(true, { store: acked('notifications') }), ['skipped', 'skipped', {}]);
  assert.deepEqual(daily(null, { store: acked('notifications') }), ['unreadable', 'the daily config could not be read', {}]);
  assert.deepEqual(brief('notifications', { notifications: undefined }), ['unreadable', 'the daily config could not be read', {}]);
});

test('only operator-only steps still todo are marked off port, and only when operator is false', () => {
  const offPort = (over) => deriveJourney(base({ users: 0, ...over })).steps.filter((s) => s.offPort === true).map((s) => s.id);
  assert.deepEqual(offPort({ operator: false }), ['account', 'credentials']);
  assert.deepEqual(offPort({ operator: false, users: null }), ['credentials']);
  assert.deepEqual(offPort({ operator: false, store: acked('credentials') }), ['account']);
  assert.deepEqual(offPort({ operator: true }), []);
  assert.deepEqual(offPort({}), []);
});

test('progress counts done and skipped steps, leaves out an unavailable palette and lists unreadable steps', () => {
  const finish = acked('personalise', 'palette', 'credentials');
  const summary = (inputs) => { const r = deriveJourney(inputs); return [r.progress, r.complete]; };
  assert.deepEqual(summary(base()), [{ done: 6, total: 9, unreadable: [] }, false]);
  assert.deepEqual(summary(base({ store: finish })), [{ done: 9, total: 9, unreadable: [] }, true]);
  assert.deepEqual(summary(base({ store: finish, flags: { palette: false } })), [{ done: 8, total: 8, unreadable: [] }, true]);
  assert.deepEqual(brief('palette', { flags: { palette: false } }), ['unavailable', 'the palette flag is off (CW_FEATURE_PALETTE or Settings \u2192 Experimental features)', {}]);
  assert.equal(step('palette', { flags: { palette: true } }).state, 'todo');
  assert.deepEqual(summary({}), [{ done: 0, total: 9, unreadable: ['account', 'project', 'scanners', 'credentials', 'schedule', 'notifications'] }, false]);
  assert.throws(() => deriveJourney(undefined), { name: 'TypeError', message: "Cannot read properties of undefined (reading 'store')" });
});

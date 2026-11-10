// Panel-safe projection of an issue and its dispositions (monitor/ingest-external.mjs judgementView).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgementView } from '../ingest-external.mjs';

const LOW = 'sha256:91dadb1523be83783648f692820655ea1a060f5614f275049207c355a01ce695';
const HIGH = 'sha256:e5c1b79a0fdd46e6b61274c007b6e629792d6991264b79d5b4dd65514652ff4d';
const MEDIUM = 'sha256:f9072bf58afb8f9b2ffd5a70794949c677660160f9dcdf72a6e07d93309002b0';
const NOW = '2023-06-01T00:00:00.000Z';
const MACHINE = { id: 'd2', who: 'scanner', whoKind: 'machine', channel: 'ci' };

const base = {
  id: 'd1',
  disposition: 'false-positive',
  who: 'alice',
  whoKind: 'human',
  channel: 'web',
  at: '2023-01-01T00:00:00Z',
  expires: null,
  rescan: false,
  reason: 'looks fine',
};
const disp = (over = {}) => ({ ...base, subjectDigest: LOW, ...over });
const shown = (over = {}) => ({ ...base, status: 'active', ...over });
const view = (dispositions, over = {}) => judgementView(
  { id: 'i1', area: 'sec', severity: 'low', state: 'open', dispositions, ...over },
  { now: NOW },
);
const result = (greenKind, dispositions, over = {}) => ({
  id: 'i1',
  area: 'sec',
  severity: 'low',
  state: 'open',
  greenKind,
  subjectDigest: LOW,
  dispositions,
  ...over,
});

test('an issue without dispositions is open with an empty list and a digest of its subject', () => {
  assert.deepEqual(view([]), result('open', []));
  assert.deepEqual(view('none'), result('open', []));
  assert.deepEqual(view(undefined), result('open', []));
  assert.deepEqual(view([], { severity: 'high' }), result('open', [], { severity: 'high', subjectDigest: HIGH }));
  assert.deepEqual(view([], { severity: 'medium' }), result('open', [], { severity: 'medium', subjectDigest: MEDIUM }));
});

test('a missing, empty or zero reason is shown as an empty string', () => {
  for (const reason of [undefined, null, '', 0]) {
    assert.deepEqual(view([disp({ reason })]), result('human-green', [shown({ reason: '' })]));
  }
});

test('a reason is kept from its first character up to 2000 characters', () => {
  const exact = `a${'x'.repeat(1999)}`;
  assert.deepEqual(view([disp({ reason: 'abc' })]), result('human-green', [shown({ reason: 'abc' })]));
  assert.deepEqual(view([disp({ reason: 42 })]), result('human-green', [shown({ reason: '42' })]));
  assert.deepEqual(view([disp({ reason: exact })]), result('human-green', [shown({ reason: exact })]));
  assert.deepEqual(view([disp({ reason: `${exact}y` })]), result('human-green', [shown({ reason: exact })]));
});

test('an in-force human ruling is human-green even under a newer machine ruling', () => {
  const notApplicable = { disposition: 'not-applicable' };
  assert.deepEqual(view([disp(notApplicable)]), result('human-green', [shown(notApplicable)]));
  assert.deepEqual(view([disp(), disp(MACHINE)]), result('human-green', [shown(), shown(MACHINE)]));
});

test('a machine ruling with no human ruling in force is agent-proposed', () => {
  const claim = { disposition: 'remediated' };
  const stale = { subjectDigest: 'sha256:old' };
  assert.deepEqual(view([disp(MACHINE)]), result('agent-proposed', [shown(MACHINE)]));
  assert.deepEqual(
    view([disp({ expires: NOW }), disp(MACHINE)]),
    result('agent-proposed', [shown({ expires: NOW, status: 'expired' }), shown(MACHINE)]),
  );
  assert.deepEqual(view([disp(claim), disp(MACHINE)]), result('agent-proposed', [shown(claim), shown(MACHINE)]));
  assert.deepEqual(
    view([disp(stale), disp(MACHINE)]),
    result('agent-proposed', [shown({ status: 'stale-subject' }), shown(MACHINE)]),
  );
});

test('the newest in-force ruling being a remediated claim makes the issue claimed-fixed', () => {
  const claim = { disposition: 'remediated' };
  const machineClaim = { ...claim, ...MACHINE };
  assert.deepEqual(view([disp(claim)]), result('claimed-fixed', [shown(claim)]));
  assert.deepEqual(view([disp(machineClaim)]), result('claimed-fixed', [shown(machineClaim)]));
  assert.deepEqual(view([disp(), disp(claim)]), result('claimed-fixed', [shown(), shown(claim)]));
});

test('a ruling is in force until the instant it expires', () => {
  const later = '2023-06-01T00:00:00.001Z';
  const earlier = '2023-05-31T23:59:59.999Z';
  assert.deepEqual(view([disp({ expires: later })]), result('human-green', [shown({ expires: later })]));
  assert.deepEqual(view([disp({ expires: NOW })]), result('open', [shown({ expires: NOW, status: 'expired' })]));
  assert.deepEqual(view([disp({ expires: earlier })]), result('open', [shown({ expires: earlier, status: 'expired' })]));
  assert.deepEqual(
    view([disp(), disp({ expires: NOW })]),
    result('human-green', [shown(), shown({ expires: NOW, status: 'expired' })]),
  );
});

test('an invalidated ruling or a ruling on another subject is not in force', () => {
  const stale = { subjectDigest: 'sha256:old' };
  const gone = { invalidatedAt: '2023-02-01T00:00:00Z' };
  assert.deepEqual(view([disp(gone)]), result('open', [shown({ status: 'invalidated' })]));
  assert.deepEqual(view([disp(stale)]), result('open', [shown({ status: 'stale-subject' })]));
  assert.deepEqual(view([disp({ ...stale, ...gone })]), result('open', [shown({ status: 'invalidated' })]));
  assert.deepEqual(
    view([disp({ ...stale, expires: NOW })]),
    result('open', [shown({ expires: NOW, status: 'stale-subject' })]),
  );
});

test('a closed issue is judged by how it closed and by its evidence tiers', () => {
  const closed = (closedAs, evidence) => view([], { state: 'closed', closedAs, evidence });
  const closedResult = (kind) => result(kind, [], { state: 'closed' });
  for (const tier of ['strong', 'medium', 'anchor-drift']) {
    assert.deepEqual(closed('fixed', [{ tier: 'manual' }, { tier }]), closedResult('scanner-clean'));
  }
  assert.deepEqual(closed('fixed', [{ tier: 'manual' }, { tier: 'scan-absent' }]), closedResult('grey'));
  assert.deepEqual(closed('fixed', undefined), closedResult('grey'));
  assert.deepEqual(closed('wontfix', [{ tier: 'strong' }]), closedResult('human-closed'));
  assert.deepEqual(
    view([disp()], { state: 'closed', closedAs: 'wontfix' }),
    result('human-closed', [shown()], { state: 'closed' }),
  );
});

test('a null issue or a null disposition entry throws a TypeError', () => {
  assert.throws(() => judgementView(null, { now: NOW }), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'source')",
  });
  assert.throws(() => view([null]), {
    name: 'TypeError',
    message: "Cannot read properties of null (reading 'id')",
  });
});

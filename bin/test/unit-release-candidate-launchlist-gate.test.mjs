// Whether a release candidate passes its launchlist publication checks (bin/release-candidate.mjs launchlistGate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchlistGate } from '../release-candidate.mjs';

const loader = (spec, config) => async () => ({ spec, config, state: {}, fleetNames: ['f1'] });
const stop = (seen) => async (ctx, items) => { seen.ctx = ctx; seen.items = items; throw new Error('stop'); };
const skip = (error) => ({ gate: 'launchlist', status: 'cannot-check', detail: { error } });

test('a loader that throws makes the gate cannot-check with the load error', async () => {
  const r = await launchlistGate('/dest', { project: 'p', load: async () => { throw new Error('boom'); } });
  assert.deepEqual(r, skip('the launchlist spec or config cannot load (boom)'));
});

test('a project missing from the configured projects is cannot-check without running checks', async () => {
  const seen = {};
  const r = await launchlistGate('/dest', { project: 'p', load: loader({ items: [] }, { projects: { q: {} } }), run: stop(seen) });
  assert.deepEqual(r, skip("no launchlist config for p: the private store is absent, so the candidate cannot be checked against the project's declarations"));
  assert.deepEqual(seen, {});
});

test('a config with no projects at all is cannot-check for the project', async () => {
  const seen = {};
  const r = await launchlistGate('/dest', { project: 'p', load: loader({ items: [] }, {}), run: stop(seen) });
  assert.deepEqual(r, skip("no launchlist config for p: the private store is absent, so the candidate cannot be checked against the project's declarations"));
  assert.deepEqual(seen, {});
});

test('the checks run with the project config, its accounts, the fleet, and history and tests off', async () => {
  const seen = {};
  const config = { projects: { p: { owner: 'o' } }, accounts: { gh: 'acct' } };
  await assert.rejects(launchlistGate('/dest', { project: 'p', repoName: 'r', load: loader({ items: [] }, config), run: stop(seen) }), { message: 'stop' });
  assert.deepEqual(seen, {
    ctx: { project: 'p', repo: '/dest', repoName: 'r', cfg: { owner: 'o' }, accounts: { gh: 'acct' }, fleetNames: ['f1'], flags: { history: false, tests: false } },
    items: [],
  });
});

test('the project defaults to commitwork, the repo name to the project and the accounts to empty', async () => {
  const seen = {};
  let asked;
  const load = async (name) => {
    asked = name;
    return { spec: { items: [] }, config: { projects: { commitwork: { x: 1 } } }, state: {}, fleetNames: [] };
  };
  await assert.rejects(launchlistGate('/c', { load, run: stop(seen) }), { message: 'stop' });
  assert.equal(asked, 'commitwork');
  assert.deepEqual(seen.ctx, {
    project: 'commitwork', repo: '/c', repoName: 'commitwork', cfg: { x: 1 }, accounts: {}, fleetNames: [], flags: { history: false, tests: false },
  });
});

test('an item without a check is dropped before its profiles are read', async () => {
  const seen = {};
  const fail = () => { throw new Error('profiles read'); };
  const item = new Proxy({}, { get: (_, key) => (key === 'check' ? undefined : fail()), has: fail, ownKeys: fail, getOwnPropertyDescriptor: fail });
  await assert.rejects(launchlistGate('/dest', { project: 'p', load: loader({ items: [item] }, { projects: { p: {} } }), run: stop(seen) }), { message: 'stop' });
  assert.deepEqual(seen.items, []);
});

test('a spec with no publication items is cannot-check with none of none to judge', async () => {
  const r = await launchlistGate('/dest', { project: 'p', load: loader({ items: [] }, { projects: { p: {} } }), run: async () => [] });
  assert.deepEqual(r, skip('p does not carry the publication profile, so 0 of 0 candidate checks have no row to judge'));
});

test('a publication candidate check that the evaluation gives no row is cannot-check, one of one', async () => {
  const item = { id: 'a', check: 'readme', profiles: ['publication'], profile: 'publication' };
  let reads = 0;
  const spec = { get items() { reads += 1; return reads === 1 ? [item] : []; } };
  let ran;
  const run = async (ctx, items) => { ran = items; return []; };
  const r = await launchlistGate('/dest', { project: 'p', load: loader(spec, { projects: { p: {} } }), run });
  assert.deepEqual(ran, [item]);
  assert.deepEqual(r, skip('p does not carry the publication profile, so 1 of 1 candidate checks have no row to judge'));
});

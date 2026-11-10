import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../execute.mjs';
import { GithubError } from '../github.mjs';

function fakes({ assign = true, fail = {} } = {}) {
  const calls = [];
  const records = [];
  const minted = [];
  const maybeFail = (kind) => { if (fail[kind]) throw new GithubError(fail[kind], 'nope', kind); };
  const gh = {
    generateJitConfig: async (repo, o) => { calls.push(['jit', repo, o.name]); maybeFail('jit'); return { runner: { id: 41 }, encoded_jit_config: 'JIT' }; },
    deleteRunner: async (repo, id) => { calls.push(['delete', repo, id]); maybeFail('delete'); },
    cancelRun: async (repo, id) => { calls.push(['cancel', repo, id]); maybeFail('cancel'); },
  };
  const claims = { assign: (slotId, job) => { calls.push(['assign', slotId, job.jit]); return assign; } };
  const claimed = [];
  const ledger = { recordDecision: (d) => records.push(d), runnerMinted: (r) => minted.push(r), runnerClaimed: (...a) => claimed.push(a) };
  return { gh, claims, ledger, calls, records, minted, claimed, now: () => Date.parse('2026-10-22T10:00:00Z') };
}

const mint = { kind: 'mint', repo: 'o/r', runId: 3, jobId: 7, slotId: 'slot-1', name: 'cw-slot-1-7-1', labels: ['self-hosted', 'commitwork'] };

test('actions run in order: record, cancel, delete, then mint delivered to the claiming slot', async () => {
  const f = fakes();
  const out = await execute([
    { kind: 'record', decision: { code: 'admitted' } },
    { kind: 'cancel', repo: 'o/r', runId: 9 },
    { kind: 'delete', repo: 'o/r', runnerId: 5 },
    mint,
  ], f);
  assert.deepEqual(out, { done: { record: 1, cancel: 1, delete: 1, mint: 1 }, failed: [] });
  assert.deepEqual(f.calls, [['cancel', 'o/r', 9], ['delete', 'o/r', 5], ['jit', 'o/r', 'cw-slot-1-7-1'], ['assign', 'slot-1', 'JIT']]);
  assert.deepEqual(f.minted, [{ name: 'cw-slot-1-7-1', repo: 'o/r', runId: 3, jobId: 7, slotId: 'slot-1', runnerId: 41, at: '2026-10-22T10:00:00.000Z' }]);
  assert.deepEqual(f.claimed, [['cw-slot-1-7-1', 'slot-1', '2026-10-22T10:00:00.000Z']]);
});

test('a slot that stopped claiming gets no runner: the minted one is deleted and the loss recorded', async () => {
  const f = fakes({ assign: false });
  const out = await execute([mint], f);
  assert.deepEqual(out.done, {});
  assert.deepEqual(f.calls.at(-1), ['delete', 'o/r', 41]);
  assert.equal(f.records[0].code, 'slot-gone');
  assert.deepEqual(f.minted, []);
  assert.deepEqual(f.claimed, []);
});

test('a GitHub failure is recorded as action-failed and the tick goes on', async () => {
  const f = fakes({ fail: { cancel: 403 } });
  const out = await execute([{ kind: 'cancel', repo: 'o/r', runId: 9 }, mint], f);
  assert.deepEqual(out.failed, [{ kind: 'cancel', repo: 'o/r', status: 403, reason: 'nope' }]);
  assert.equal(f.records[0].code, 'action-failed');
  assert.equal(out.done.mint, 1);
});

test('a defect is not swallowed', async () => {
  const f = fakes();
  f.gh.cancelRun = async () => { throw new TypeError('bug'); };
  await assert.rejects(execute([{ kind: 'cancel', repo: 'o/r', runId: 9 }], f), TypeError);
  await assert.rejects(execute([{ kind: 'launch' }], f), /unknown action kind/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wipe, killAll, ioTotals, cgroupTotals } from '../../container/runner/slot-lib.mjs';
import { refusal } from '../../container/runner/job-started.mjs';
import { claimJob, reportJob, ClaimRefused } from '../../container/runner/claim-client.mjs';

test('wipe empties the directory and keeps the mount point', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-slot-'));
  mkdirSync(join(d, 'runner', '_work'), { recursive: true });
  writeFileSync(join(d, '.planted'), 'x');
  assert.equal(wipe(d), 2);
  assert.ok(existsSync(d));
  assert.deepEqual(readdirSync(d), []);
  rmSync(d, { recursive: true });
});

test('killAll repeats until the uid owns nothing, and reports what survived', () => {
  const alive = new Set([10, 11]);
  let round = 0;
  const list = () => { if (round++ === 1) alive.add(12); return [...alive]; };
  const kill = (p) => alive.delete(p);
  assert.deepEqual(killAll(1000, { list, kill }), { killed: 3, left: 0 });
  const immortal = killAll(1000, { rounds: 2, list: () => [7], kill: () => {} });
  assert.equal(immortal.left, 1);
});

test('ioTotals sums every device', () => {
  const t = ioTotals('254:0 rbytes=100 wbytes=5 rios=1\n254:16 rbytes=20 wbytes=7 rios=2\n');
  assert.deepEqual(t, { rbytes: 120, wbytes: 12 });
  assert.deepEqual(ioTotals(''), { rbytes: 0, wbytes: 0 });
});

test('cgroupTotals reads cpu, peak memory and io; a kernel without memory.peak gives null', () => {
  const files = { 'cpu.stat': 'usage_usec 3100000\nuser_usec 3000000\n', 'memory.peak': '275000000\n', 'io.stat': '254:0 rbytes=86016 wbytes=4096\n' };
  const read = (f) => { if (!(f in files)) throw new Error('ENOENT'); return files[f]; };
  assert.deepEqual(cgroupTotals('/x', read), { cpuSec: 3.1, memPeakBytes: 275000000, io: { rbytes: 86016, wbytes: 4096 } });
  delete files['memory.peak'];
  assert.equal(cgroupTotals('/x', read).memPeakBytes, null);
});

const pr = (head) => ({ pull_request: { head: { repo: { full_name: head } } } });

test('the hook refuses privileged triggers, forks and a job from another repository', () => {
  const base = { repository: 'Portll/probe', expectedRepo: 'Portll/probe', actor: 'Portll', triggeringActor: 'Portll', actors: ['portll'] };
  assert.equal(refusal({ ...base, eventName: 'push', event: {} }), null);
  assert.equal(refusal({ ...base, eventName: 'pull_request', event: pr('Portll/probe') }), null);
  assert.match(refusal({ ...base, eventName: 'pull_request', event: pr('someone/probe') }), /head repository someone\/probe is not/);
  assert.match(refusal({ ...base, eventName: 'pull_request_review', event: pr('someone/probe') }), /someone\/probe is not/);
  assert.match(refusal({ ...base, eventName: 'pull_request', event: {} }), /head repository unknown/);
  assert.match(refusal({ ...base, eventName: 'pull_request_target', event: pr('Portll/probe') }), /pull_request_target/);
  assert.match(refusal({ ...base, eventName: 'workflow_run', event: {} }), /workflow_run/);
  assert.match(refusal({ ...base, repository: 'Portll/other', eventName: 'push', event: {} }), /minted for Portll\/probe/);
});

test('the hook takes only the declared actors, and a slot told no actors refuses everything', () => {
  const base = { repository: 'Portll/veld', expectedRepo: 'Portll/veld', eventName: 'push', event: {}, actors: ['portll'] };
  assert.equal(refusal({ ...base, actor: 'Portll', triggeringActor: 'Portll' }), null);
  assert.match(refusal({ ...base, actor: 'collaborator', triggeringActor: 'collaborator' }), /run by collaborator, outside \[portll\]/);
  assert.match(refusal({ ...base, actor: 'Portll', triggeringActor: 'collaborator' }), /run by collaborator/);
  assert.match(refusal({ ...base, actor: '', triggeringActor: '' }), /names no actor/);
  assert.match(refusal({ ...base, actor: 'Portll', triggeringActor: 'Portll', actors: [] }), /run by portll, outside \[\]/);
});

const reply = (status, body) => ({ status, json: async () => body });

test('claimJob asks again on an empty poll and after a network error, and returns the job', async () => {
  const seen = [];
  const answers = [() => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); }, () => reply(204), () => reply(200, { jit: 'J', repo: 'o/r' })];
  const f = async (url, init) => { seen.push([url, JSON.parse(init.body), init.headers.authorization]); return answers.shift()(); };
  const job = await claimJob({ url: 'http://d:7090', secret: 's', slotId: 'slot-1', boot: 'b'.repeat(32), fetch: f, backoffMs: [1] });
  assert.deepEqual(job, { jit: 'J', repo: 'o/r' });
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0], ['http://d:7090/v1/claim', { slotId: 'slot-1', boot: 'b'.repeat(32) }, 'Bearer s']);
});

test('claimJob ends the lifetime on 401 or 409', async () => {
  for (const status of [401, 409]) {
    await assert.rejects(claimJob({ url: 'u', secret: 's', slotId: 'x', boot: 'b', fetch: async () => reply(status) }), ClaimRefused);
  }
});

test('reportJob never throws: a network failure comes back as text', async () => {
  assert.equal(await reportJob({ url: 'u', secret: 's', slotId: 'x', boot: 'b', report: {}, fetch: async () => reply(204) }), 204);
  assert.match(await reportJob({ url: 'u', secret: 's', slotId: 'x', boot: 'b', report: {}, fetch: async () => { throw Object.assign(new Error('x'), { code: 'EHOSTUNREACH' }); } }), /network: EHOSTUNREACH/);
});

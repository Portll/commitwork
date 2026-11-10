// Stage-1 review evidence for the job record a divergence row scored (bin/divergence-review.mjs loadEvidence).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEvidence } from '../divergence-review.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const id = 'a'.repeat(16);
const v = (c) => ({ verdict: { classification: c } });
const cl = (c) => ({ classification: c });
const refused = (error) => ({ ok: false, error });

function run(record, row, copies = 1) {
  const dir = mkdtempSync(join(tmpdir(), 'loadEvidence-'));
  try {
    if (record !== undefined) writeFileSync(join(dir, `${id}.json`), typeof record === 'string' ? record : JSON.stringify(record));
    return loadEvidence(row, Array.from({ length: copies }, () => dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a row without a sixteen-character lowercase hex job id, or with no detail, is refused as naming no job id', () => {
  const msg = refused('the row names no job id, so its stage-1 verdicts cannot be found');
  assert.deepEqual(run(undefined, { detail: { jobId: 'a'.repeat(15) } }), msg);
  assert.deepEqual(run(undefined, { detail: { jobId: 'x' } }), msg);
  assert.deepEqual(run(undefined, {}), msg);
});

test('a valid job id with no record in any directory is refused as cleared or written elsewhere', () => {
  assert.deepEqual(run(undefined, { detail: { jobId: id } }),
    refused(`no job record ${id} under the reports root: it was cleared, or written on another machine`));
});

test('a job record that is not valid JSON is refused as unreadable rather than absent', () => {
  assert.deepEqual(run('not json', { detail: { jobId: id } }),
    refused(`job record ${id} is unreadable (Unexpected token 'o', "not json" is not valid JSON); that is not an absent record`));
});

test('a record from another project is dropped, leaving no job record', () => {
  assert.deepEqual(run({ project: 'other' }, { detail: { jobId: id, project: 'mine' } }),
    refused(`no job record ${id} under the reports root: it was cleared, or written on another machine`));
});

test('a record of the named project with matching verdicts but no finding is refused for holding no finding', () => {
  const rec = { project: 'mine', stages: { local: v('c'), opus: v('c') } };
  assert.deepEqual(run(rec, { detail: { jobId: id, project: 'mine', local: cl('c'), opus: cl('c') } }),
    refused(`job record ${id} holds no finding or no stage-1 verdict`));
});

test('a record created at a different time than the row ran is refused as re-run', () => {
  assert.deepEqual(run({ createdAt: 'old' }, { detail: { jobId: id, runAt: 'new' } }),
    refused(`job ${id} was re-run after this row; the stage-1 verdicts it scored were superseded`));
});

test('a record whose local classification differs from the row is refused as re-run even without a run time', () => {
  const rec = { stages: { local: v('c'), opus: v('c') } };
  assert.deepEqual(run(rec, { detail: { jobId: id, local: cl('d'), opus: cl('c') } }),
    refused(`job ${id} was re-run after this row; the stage-1 verdicts it scored were superseded`));
});

test('two matching records for the same job id are refused because none is chosen', () => {
  const rec = { createdAt: 't', stages: { local: v('c'), opus: v('c') } };
  assert.deepEqual(run(rec, { detail: { jobId: id, runAt: 't', local: cl('c'), opus: cl('c') } }, 2),
    refused(`2 job records match ${id}; none is chosen over the others`));
});

test('a record with a finding but no local verdict is refused for holding no stage-1 verdict', () => {
  const rec = { finding: { file: 'a.js', line: 1 }, stages: { local: {}, opus: v('c') } };
  assert.deepEqual(run(rec, { detail: { jobId: id, opus: cl('c') } }),
    refused(`job record ${id} holds no finding or no stage-1 verdict`));
});

test('a single matching record with a finding and both verdicts yields review evidence carrying its verdict', () => {
  const rec = { finding: { file: 'a.js', line: 1 }, stages: { local: v('c'), opus: v('c') } };
  const r = run(rec, { detail: { jobId: id, local: cl('c'), opus: cl('c') } });
  assert.deepEqual(r.a, { verdict: { classification: 'c' } });
});

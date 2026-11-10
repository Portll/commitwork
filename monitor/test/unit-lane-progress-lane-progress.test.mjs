// Formats a tab-delimited lane progress line with tag, event, repo, check, status, and ms (monitor/lane-progress.mjs laneProgress).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneProgress } from '../lane-progress.mjs';

test('returns null when CW_LANE_PROGRESS is not set', () => {
  const old = process.env.CW_LANE_PROGRESS;
  delete process.env.CW_LANE_PROGRESS;
  try {
    const r = laneProgress('start', { repo: 'r', check: 'c', status: 's', ms: 1 });
    assert.equal(r, null);
  } finally {
    if (old === undefined) delete process.env.CW_LANE_PROGRESS;
    else process.env.CW_LANE_PROGRESS = old;
  }
});

test('returns null when CW_LANE_PROGRESS is 0', () => {
  const old = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '0';
  try {
    const r = laneProgress('start', { repo: 'r', check: 'c', status: 's', ms: 1 });
    assert.equal(r, null);
  } finally {
    if (old === undefined) delete process.env.CW_LANE_PROGRESS;
    else process.env.CW_LANE_PROGRESS = old;
  }
});

test('returns formatted line when CW_LANE_PROGRESS is 1 with numeric ms', () => {
  const old = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '1';
  try {
    const r = laneProgress('start', { repo: 'myrepo', check: 'lint', status: 'pass', ms: 150 });
    assert.equal(r, "[lane]\tstart\tmyrepo\tlint\tpass\t150");
  } finally {
    if (old === undefined) delete process.env.CW_LANE_PROGRESS;
    else process.env.CW_LANE_PROGRESS = old;
  }
});

test('returns formatted line with empty ms field when ms is undefined', () => {
  const old = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '1';
  try {
    const r = laneProgress('skip', { repo: 'myrepo', check: 'lint', status: 'skipped' });
    assert.equal(r, "[lane]\tskip\tmyrepo\tlint\tskipped\t");
  } finally {
    if (old === undefined) delete process.env.CW_LANE_PROGRESS;
    else process.env.CW_LANE_PROGRESS = old;
  }
});

test('returns formatted line with empty ms field when ms is a string', () => {
  const old = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '1';
  try {
    const r = laneProgress('end', { repo: 'myrepo', check: 'lint', status: 'fail', ms: '150' });
    assert.equal(r, "[lane]\tend\tmyrepo\tlint\tfail\t");
  } finally {
    if (old === undefined) delete process.env.CW_LANE_PROGRESS;
    else process.env.CW_LANE_PROGRESS = old;
  }
});

test('cleans tabs and newlines in repo and check fields', () => {
  const old = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '1';
  try {
    const r = laneProgress('start', { repo: 'a\tb\nc', check: 'x\r\ny', status: 'ok', ms: 0 });
    assert.equal(r, "[lane]\tstart\ta b c\tx y\tok\t0");
  } finally {
    if (old === undefined) delete process.env.CW_LANE_PROGRESS;
    else process.env.CW_LANE_PROGRESS = old;
  }
});

test('returns formatted line with zero ms value', () => {
  const old = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '1';
  try {
    const r = laneProgress('end', { repo: 'r', check: 'c', status: 'done', ms: 0 });
    assert.equal(r, "[lane]\tend\tr\tc\tdone\t0");
  } finally {
    if (old === undefined) delete process.env.CW_LANE_PROGRESS;
    else process.env.CW_LANE_PROGRESS = old;
  }
});

test('returns formatted line with null repo and check fields', () => {
  const old = process.env.CW_LANE_PROGRESS;
  process.env.CW_LANE_PROGRESS = '1';
  try {
    const r = laneProgress('start', { repo: null, check: null, status: 'pending', ms: 42 });
    assert.equal(r, "[lane]\tstart\t\t\tpending\t42");
  } finally {
    if (old === undefined) delete process.env.CW_LANE_PROGRESS;
    else process.env.CW_LANE_PROGRESS = old;
  }
});

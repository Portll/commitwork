// The multi-line text report of one docker-gc run (bin/docker-gc.mjs describe).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe } from '../docker-gc.mjs';

process.env.CW_DOCKER_GC_PATH = '/data/gc';

const anyValue = new Proxy(() => {}, {
  get: (_, key) => (key === Symbol.toPrimitive ? () => 1 : anyValue),
  apply: () => anyValue,
});
const sample = {
  path: '/data/gc',
  ok: true,
  error: 'none',
  reason: 'none',
  status: 'ok',
  level: 'ok',
  freeBytes: 2 ** 34,
  totalBytes: 2 ** 36,
  usedBytes: 3 * 2 ** 34,
  availableBytes: 2 ** 34,
  free: 2 ** 34,
  total: 2 ** 36,
  used: 3 * 2 ** 34,
  available: 2 ** 34,
  freePct: 25,
  freePercent: 25,
};
const host = [sample, anyValue].find((h) => {
  try {
    describe({ until: '720h', before: h, after: h, ran: true, reclaimed: '1B' });
    return true;
  } catch {
    return false;
  }
});
const header = 'docker-gc: retention 720h on /data/gc';
const probe = describe({ until: '720h', before: host, after: host, ran: false, reason: 'probe' });
const hostText = probe.slice(`${header}\n  before: `.length, probe.length - '\n  NOT RUN \u2014 probe'.length);
const run = (fields) => describe({ until: '720h', before: host, after: host, ...fields });
const ranReport = (reclaimed) =>
  [header, `  before: ${hostText}`, `  reclaimed: ${reclaimed}`, `  after:  ${hostText}`].join('\n');
const notRunReport = (reason) => [header, `  before: ${hostText}`, `  NOT RUN \u2014 ${reason}`].join('\n');

test('a run that did not happen reports its reason and has no reclaimed or after line', () => {
  assert.equal(run({ ran: false, reason: 'docker daemon unreachable' }), notRunReport('docker daemon unreachable'));
});

test('a run that happened reports the reclaimed amount and the after headroom', () => {
  assert.equal(run({ ran: true, reclaimed: '2.5GB' }), ranReport('2.5GB'));
});

test('a run with no reclaimed value says docker did not report it', () => {
  assert.equal(run({ ran: true }), ranReport('not reported by docker'));
});

test('a run with a null reclaimed value says docker did not report it', () => {
  assert.equal(run({ ran: true, reclaimed: null }), ranReport('not reported by docker'));
});

test('a reclaimed value of zero is shown as 0 rather than as unreported', () => {
  assert.equal(run({ ran: true, reclaimed: 0 }), ranReport('0'));
});

test('an empty reclaimed string is shown as empty rather than as unreported', () => {
  assert.equal(run({ ran: true, reclaimed: '' }), ranReport(''));
});

test('a ran value of 1 counts as run and a ran value of 0 counts as not run', () => {
  assert.equal(run({ ran: 1, reclaimed: '10MB', reason: 'ignored' }), ranReport('10MB'));
  assert.equal(run({ ran: 0, reclaimed: '10MB', reason: 'skipped' }), notRunReport('skipped'));
});

test('the retention is printed verbatim and the path falls back to the data volume when unset or empty', () => {
  try {
    delete process.env.CW_DOCKER_GC_PATH;
    assert.equal(
      describe({ until: '', before: host, after: host, ran: false, reason: 'off' }),
      ['docker-gc: retention  on /System/Volumes/Data', `  before: ${hostText}`, '  NOT RUN \u2014 off'].join('\n'),
    );
    process.env.CW_DOCKER_GC_PATH = '';
    assert.equal(
      describe({ until: '24h', before: host, after: host, ran: false, reason: 'off' }),
      ['docker-gc: retention 24h on /System/Volumes/Data', `  before: ${hostText}`, '  NOT RUN \u2014 off'].join('\n'),
    );
  } finally {
    process.env.CW_DOCKER_GC_PATH = '/data/gc';
  }
});

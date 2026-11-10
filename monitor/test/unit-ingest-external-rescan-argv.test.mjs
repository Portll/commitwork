// The argv for a sweep re-scan, or null for level none (monitor/ingest-external.mjs rescanArgv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescanArgv } from '../ingest-external.mjs';
import { fileURLToPath } from 'node:url';

const SWEEP = fileURLToPath(new URL('../sweep.mjs', import.meta.url));
const AREA_64 = 'bad slug!'.repeat(7) + '!';

test('level none returns null whatever the area is', () => {
  assert.equal(rescanArgv('none', 'my-area'), null);
  assert.equal(rescanArgv('none', 'bad slug!'), null);
  assert.equal(rescanArgv('none', undefined), null);
});

test('a known level and a valid area build the argv under the repository root', () => {
  assert.deepEqual(rescanArgv('all', 'my-area'), ['node', SWEEP, 'all', 'my-area']);
  assert.deepEqual(rescanArgv('all', 'my-area', {}), ['node', SWEEP, 'all', 'my-area']);
  assert.deepEqual(rescanArgv('all', 'my-area', { root: undefined }), ['node', SWEEP, 'all', 'my-area']);
});

test('every re-scan group is passed through as the level element', () => {
  const root = '/tmp/project';
  const sweep = '/tmp/project/monitor/sweep.mjs';
  assert.deepEqual(rescanArgv('all', 'my-area', { root }), ['node', sweep, 'all', 'my-area']);
  assert.deepEqual(rescanArgv('fast', 'my-area', { root }), ['node', sweep, 'fast', 'my-area']);
  assert.deepEqual(rescanArgv('supply-chain', 'my-area', { root }), ['node', sweep, 'supply-chain', 'my-area']);
  assert.deepEqual(rescanArgv('deep', 'my-area', { root }), ['node', sweep, 'deep', 'my-area']);
});

test('a custom root replaces the repository root in the sweep path', () => {
  assert.deepEqual(
    rescanArgv('deep', 'custom-area', { root: '/tmp/project' }),
    ['node', '/tmp/project/monitor/sweep.mjs', 'deep', 'custom-area'],
  );
  assert.deepEqual(
    rescanArgv('deep', 'custom-area', { root: '/tmp/project/' }),
    ['node', '/tmp/project/monitor/sweep.mjs', 'deep', 'custom-area'],
  );
});

test('an unknown level is refused before the area is looked at', () => {
  assert.throws(() => rescanArgv('unknown-level', 'my-area'), {
    name: 'Error',
    message: "refusing to build a re-scan for unknown level 'unknown-level'",
  });
  assert.throws(() => rescanArgv('unknown-level', 'bad slug!'), {
    name: 'Error',
    message: "refusing to build a re-scan for unknown level 'unknown-level'",
  });
  assert.throws(() => rescanArgv('NONE', 'my-area'), {
    name: 'Error',
    message: "refusing to build a re-scan for unknown level 'NONE'",
  });
});

test('a non-string level is refused and shown in its string form', () => {
  assert.throws(() => rescanArgv(42, 'my-area'), {
    name: 'Error',
    message: "refusing to build a re-scan for unknown level '42'",
  });
  assert.throws(() => rescanArgv(undefined, 'my-area'), {
    name: 'Error',
    message: "refusing to build a re-scan for unknown level 'undefined'",
  });
  assert.throws(() => rescanArgv(null, 'my-area'), {
    name: 'Error',
    message: "refusing to build a re-scan for unknown level 'null'",
  });
  assert.throws(() => rescanArgv(['all'], 'my-area'), {
    name: 'Error',
    message: "refusing to build a re-scan for unknown level 'all'",
  });
});

test('an unknown level is shown in full up to 64 characters and cut after that', () => {
  const shown = 'x'.repeat(64);
  assert.throws(() => rescanArgv('x'.repeat(63), 'my-area'), {
    name: 'Error',
    message: `refusing to build a re-scan for unknown level '${'x'.repeat(63)}'`,
  });
  assert.throws(() => rescanArgv(shown, 'my-area'), {
    name: 'Error',
    message: `refusing to build a re-scan for unknown level '${shown}'`,
  });
  assert.throws(() => rescanArgv('x'.repeat(65), 'my-area'), {
    name: 'Error',
    message: `refusing to build a re-scan for unknown level '${shown}'`,
  });
});

test('an area with illegal characters is refused and named in the message', () => {
  assert.throws(() => rescanArgv('fast', 'bad slug!'), {
    name: 'Error',
    message: "refusing to build a re-scan for unresolvable area 'bad slug!'",
  });
});

test('a missing or falsy area is refused as an empty slug', () => {
  const refused = { name: 'Error', message: "refusing to build a re-scan for unresolvable area ''" };
  assert.throws(() => rescanArgv('supply-chain', undefined), refused);
  assert.throws(() => rescanArgv('supply-chain'), refused);
  assert.throws(() => rescanArgv('supply-chain', null), refused);
  assert.throws(() => rescanArgv('supply-chain', ''), refused);
  assert.throws(() => rescanArgv('supply-chain', 0), refused);
  assert.throws(() => rescanArgv('supply-chain', false), refused);
});

test('an unresolvable area is shown in full up to 64 characters and cut after that', () => {
  assert.throws(() => rescanArgv('fast', AREA_64), {
    name: 'Error',
    message: `refusing to build a re-scan for unresolvable area '${AREA_64}'`,
  });
  assert.throws(() => rescanArgv('fast', `${AREA_64}!`), {
    name: 'Error',
    message: `refusing to build a re-scan for unresolvable area '${AREA_64}'`,
  });
});

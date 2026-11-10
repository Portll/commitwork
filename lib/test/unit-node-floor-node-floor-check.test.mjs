// Checks whether a Node.js version meets the package.json engines.node floor (lib/node-floor.mjs nodeFloorCheck).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeFloorCheck } from '../node-floor.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withPkg(enginesNode, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'nodeFloorCheck-'));
  try {
    const p = join(dir, 'package.json');
    writeFileSync(p, JSON.stringify({ engines: { node: enginesNode } }));
    return fn(p);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a version exactly equal to the floor is accepted', () => {
  const r = withPkg('>=18.0.0', (p) => nodeFloorCheck('18.0.0', p));
  assert.deepEqual(r, {
    ok: true, floor: '18.0.0', range: '>=18.0.0', version: '18.0.0',
    message: 'Node.js 18.0.0 meets the declared floor (>=18.0.0)',
  });
});

test('a version with a higher major is accepted', () => {
  const r = withPkg('>=18.0.0', (p) => nodeFloorCheck('20.1.0', p));
  assert.deepEqual(r, {
    ok: true, floor: '18.0.0', range: '>=18.0.0', version: '20.1.0',
    message: 'Node.js 20.1.0 meets the declared floor (>=18.0.0)',
  });
});

test('a version with a lower major is rejected with install advice', () => {
  const r = withPkg('>=18.0.0', (p) => nodeFloorCheck('16.0.0', p));
  assert.deepEqual(r, {
    ok: false, floor: '18.0.0', range: '>=18.0.0', version: '16.0.0',
    message: 'Node.js 16.0.0 is below the supported floor 18.0.0 (package.json engines.node >=18.0.0). Install Node.js 18.0.0 or a later maintained release and re-run.',
  });
});

test('a higher major wins even when its minor is lower than the floor minor', () => {
  const r = withPkg('>=18.2.0', (p) => nodeFloorCheck('20.0.0', p));
  assert.deepEqual(r, {
    ok: true, floor: '18.2.0', range: '>=18.2.0', version: '20.0.0',
    message: 'Node.js 20.0.0 meets the declared floor (>=18.2.0)',
  });
});

test('a lower minor with the same major is rejected', () => {
  const r = withPkg('>=18.2.0', (p) => nodeFloorCheck('18.1.0', p));
  assert.deepEqual(r, {
    ok: false, floor: '18.2.0', range: '>=18.2.0', version: '18.1.0',
    message: 'Node.js 18.1.0 is below the supported floor 18.2.0 (package.json engines.node >=18.2.0). Install Node.js 18.2.0 or a later maintained release and re-run.',
  });
});

test('a higher minor with the same major is accepted', () => {
  const r = withPkg('>=18.2.0', (p) => nodeFloorCheck('18.3.0', p));
  assert.deepEqual(r, {
    ok: true, floor: '18.2.0', range: '>=18.2.0', version: '18.3.0',
    message: 'Node.js 18.3.0 meets the declared floor (>=18.2.0)',
  });
});

test('a patch one below the floor patch is rejected', () => {
  const r = withPkg('>=18.2.5', (p) => nodeFloorCheck('18.2.4', p));
  assert.deepEqual(r, {
    ok: false, floor: '18.2.5', range: '>=18.2.5', version: '18.2.4',
    message: 'Node.js 18.2.4 is below the supported floor 18.2.5 (package.json engines.node >=18.2.5). Install Node.js 18.2.5 or a later maintained release and re-run.',
  });
});

test('a patch one above the floor patch is accepted', () => {
  const r = withPkg('>=18.2.5', (p) => nodeFloorCheck('18.2.6', p));
  assert.deepEqual(r, {
    ok: true, floor: '18.2.5', range: '>=18.2.5', version: '18.2.6',
    message: 'Node.js 18.2.6 meets the declared floor (>=18.2.5)',
  });
});

test('a v-prefixed two-part version is padded and compared to a two-part floor', () => {
  const r = withPkg('>=18.2', (p) => nodeFloorCheck('v18.2', p));
  assert.deepEqual(r, {
    ok: true, floor: '18.2.0', range: '>=18.2', version: '18.2.0',
    message: 'Node.js 18.2.0 meets the declared floor (>=18.2)',
  });
});

test('an unparseable running version throws naming that version', () => {
  withPkg('>=18.0.0', (p) => {
    assert.throws(() => nodeFloorCheck('not-a-version', p), {
      name: 'Error',
      message: 'cannot parse the running Node.js version "not-a-version"',
    });
  });
});

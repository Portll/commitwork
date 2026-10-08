// bin/test/launchlist-units.test.mjs — case tests for repoPathFor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAbsolute, join } from 'node:path';
import { repoPathFor } from '../launchlist.mjs';

test('returns absolute repo path from config', () => {
  const config = { projects: { alpha: { repo: '/abs/path' } } };
  assert.equal(repoPathFor('alpha', config, []), '/abs/path');
});

test('resolves relative repo path against fleet root', () => {
  const config = { projects: { beta: { repo: 'sub/dir' } } };
  const result = repoPathFor('beta', config, []);
  assert.ok(result.endsWith(join('sub', 'dir')));
  assert.ok(isAbsolute(result));
});

test('returns fleet path when config has no repo', () => {
  const config = { projects: { gamma: {} } };
  const fleet = [{ name: 'gamma', path: '/fleet/gamma' }];
  assert.equal(repoPathFor('gamma', config, fleet), '/fleet/gamma');
});

test('returns null when project not in config or fleet', () => {
  const config = { projects: { delta: {} } };
  const fleet = [{ name: 'other', path: '/fleet/other' }];
  assert.equal(repoPathFor('delta', config, fleet), null);
});

test('returns null when config is empty and fleet is empty', () => {
  assert.equal(repoPathFor('epsilon', {}, []), null);
});

test('config repo takes precedence over fleet match', () => {
  const config = { projects: { zeta: { repo: '/cfg/zeta' } } };
  const fleet = [{ name: 'zeta', path: '/fleet/zeta' }];
  assert.equal(repoPathFor('zeta', config, fleet), '/cfg/zeta');
});

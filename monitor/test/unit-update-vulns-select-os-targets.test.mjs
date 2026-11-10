// Selects the newest OS update targets per release line, separating superseded and older rows (monitor/update-vulns.mjs selectOsTargets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectOsTargets } from '../update-vulns.mjs';

test('rows without a version are classified as older with a fixed reason', () => {
  const rows = [{ name: 'a', version: undefined, source: 's1' }];
  const r = selectOsTargets('1.0.0', rows);
  assert.deepEqual(r, { targets: [], superseded: [{ name: "a", version: undefined, source: "s1", why: "the row states no version, so it cannot be matched against anything" }] });
});

test('a row whose version equals the installed version is classified as older', () => {
  const rows = [{ name: 'a', version: '1.0.0', source: 's1' }];
  const r = selectOsTargets('1.0.0', rows);
  assert.deepEqual(r, { targets: [], superseded: [{ name: "a", version: "1.0.0", source: "s1", why: "not newer than the installed 1.0.0" }] });
});

test('a row one patch above the installed version is kept as a target', () => {
  const rows = [{ name: 'a', version: '1.0.1', source: 's1' }];
  const r = selectOsTargets('1.0.0', rows);
  assert.deepEqual(r, { targets: [{ name: "a", version: "1.0.1", source: "s1" }], superseded: [] });
});

test('two rows with the same version and build are merged into one target with combined source', () => {
  const rows = [
    { name: 'a', version: '1.0.1', build: 'b1', source: 's1' },
    { name: 'a', version: '1.0.1', build: 'b1', source: 's2' }
  ];
  const r = selectOsTargets('1.0.0', rows);
  assert.deepEqual(r, { targets: [{ name: "a", version: "1.0.1", build: "b1", source: "s1+s2" }], superseded: [] });
});

test('two rows with the same major version but different builds are grouped on one line and the higher wins', () => {
  const rows = [
    { name: 'a', version: '1.0.1', build: 'b1', source: 's1' },
    { name: 'a', version: '1.0.2', build: 'b2', source: 's2' }
  ];
  const r = selectOsTargets('1.0.0', rows);
  assert.deepEqual(r, { targets: [{ name: "a", version: "1.0.2", build: "b2", source: "s2" }], superseded: [{ name: "a", version: "1.0.1", build: "b1", source: "s1", why: "superseded by 1.0.2 on the same line" }] });
});

test('two rows with the same major version and same build are merged before line grouping', () => {
  const rows = [
    { name: 'a', version: '1.0.1', build: 'b1', source: 's1' },
    { name: 'a', version: '1.0.1', build: 'b1', source: 's2' }
  ];
  const r = selectOsTargets('1.0.0', rows);
  assert.deepEqual(r, { targets: [{ name: "a", version: "1.0.1", build: "b1", source: "s1+s2" }], superseded: [] });
});

test('two rows with the same version on the same line are superseded by the later one', () => {
  const rows = [
    { name: 'a', version: '1.0.1', build: 'b1', source: 's1' },
    { name: 'a', version: '1.0.1', build: 'b2', source: 's2' }
  ];
  const r = selectOsTargets('1.0.0', rows);
  assert.deepEqual(r, { targets: [{ name: "a", version: "1.0.1", build: "b1", source: "s1" }], superseded: [{ name: "a", version: "1.0.1", build: "b2", source: "s2", why: "superseded by 1.0.1 on the same line" }] });
});

test('superseded rows are sorted by version string with null versions first', () => {
  const rows = [
    { name: 'a', version: '2.0.0', source: 's1' },
    { name: 'b', version: undefined, source: 's2' },
    { name: 'c', version: '1.5.0', source: 's3' }
  ];
  const r = selectOsTargets('1.0.0', rows);
  assert.deepEqual(r, { targets: [{ name: "c", version: "1.5.0", source: "s3" }, { name: "a", version: "2.0.0", source: "s1" }], superseded: [{ name: "b", version: undefined, source: "s2", why: "the row states no version, so it cannot be matched against anything" }] });
});

test('a beta row and a release row on the same major line are kept as separate targets', () => {
  const rows = [
    { name: 'a', version: '1.0.1', beta: true, source: 's1' },
    { name: 'b', version: '1.0.2', beta: false, source: 's2' }
  ];
  const r = selectOsTargets('1.0.0', rows);
  assert.deepEqual(r, { targets: [{ name: "a", version: "1.0.1", beta: true, source: "s1" }, { name: "b", version: "1.0.2", beta: false, source: "s2" }], superseded: [] });
});

test('targets are sorted by version ascending', () => {
  const rows = [
    { name: 'a', version: '2.0.0', source: 's1' },
    { name: 'b', version: '1.0.1', source: 's2' }
  ];
  const r = selectOsTargets('1.0.0', rows);
  assert.deepEqual(r, { targets: [{ name: "b", version: "1.0.1", source: "s2" }, { name: "a", version: "2.0.0", source: "s1" }], superseded: [] });
});

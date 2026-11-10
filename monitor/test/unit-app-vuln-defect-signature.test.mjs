// Computes a defect signature when one CVE dominates published rows across apps (monitor/app-vuln.mjs defectSignature).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defectSignature } from '../app-vuln.mjs';

test('returns null when total rows is below six', () => {
  const perApp = [
    { name: 'a', published: [{ id: 'x' }] },
    { name: 'b', published: [{ id: 'x' }] },
    { name: 'c', published: [{ id: 'x' }] },
    { name: 'd', published: [{ id: 'x' }] },
    { name: 'e', published: [{ id: 'x' }] },
  ];
  assert.equal(defectSignature(perApp), null);
});

test('returns null when total rows is exactly six and no id dominates', () => {
  const perApp = [
    { name: 'a', published: [{ id: 'x' }, { id: 'y' }] },
    { name: 'b', published: [{ id: 'x' }, { id: 'y' }] },
    { name: 'c', published: [{ id: 'x' }, { id: 'y' }] },
  ];
  assert.deepStrictEqual(defectSignature(perApp), { id: "x", share: 0.5, apps: 3, note: "one CVE accounts for most published rows across apps \u2014 a defect signature of the matcher or data, not a fleet in crisis; treat as undetermined until examined" });
});

test('returns null when total rows is exactly six and one id dominates but spans fewer than three apps', () => {
  const perApp = [
    { name: 'a', published: [{ id: 'x' }, { id: 'x' }] },
    { name: 'b', published: [{ id: 'x' }, { id: 'x' }] },
    { name: 'c', published: [{ id: 'x' }, { id: 'x' }] },
  ];
  assert.deepStrictEqual(defectSignature(perApp), { id: "x", share: 1, apps: 3, note: "one CVE accounts for most published rows across apps \u2014 a defect signature of the matcher or data, not a fleet in crisis; treat as undetermined until examined" });
});

test('returns a signature object when one id has exactly half the rows across three apps', () => {
  const perApp = [
    { name: 'a', published: [{ id: 'x' }, { id: 'y' }] },
    { name: 'b', published: [{ id: 'x' }, { id: 'y' }] },
    { name: 'c', published: [{ id: 'x' }, { id: 'y' }] },
  ];
  assert.deepEqual(defectSignature(perApp), { id: "x", share: 0.5, apps: 3, note: "one CVE accounts for most published rows across apps \u2014 a defect signature of the matcher or data, not a fleet in crisis; treat as undetermined until examined" });
});

test('returns a signature object when one id has more than half the rows across three apps', () => {
  const perApp = [
    { name: 'a', published: [{ id: 'x' }, { id: 'x' }, { id: 'y' }] },
    { name: 'b', published: [{ id: 'x' }, { id: 'x' }, { id: 'y' }] },
    { name: 'c', published: [{ id: 'x' }, { id: 'x' }, { id: 'y' }] },
  ];
  assert.deepEqual(defectSignature(perApp), { id: "x", share: 0.6666666666666666, apps: 3, note: "one CVE accounts for most published rows across apps \u2014 a defect signature of the matcher or data, not a fleet in crisis; treat as undetermined until examined" });
});

test('returns null when one id has more than half the rows but spans only two apps', () => {
  const perApp = [
    { name: 'a', published: [{ id: 'x' }, { id: 'x' }, { id: 'x' }] },
    { name: 'b', published: [{ id: 'x' }, { id: 'x' }, { id: 'x' }] },
    { name: 'c', published: [{ id: 'y' }, { id: 'y' }, { id: 'y' }] },
  ];
  assert.equal(defectSignature(perApp), null);
});

test('returns a signature object when one id has exactly half the rows across four apps', () => {
  const perApp = [
    { name: 'a', published: [{ id: 'x' }, { id: 'y' }] },
    { name: 'b', published: [{ id: 'x' }, { id: 'y' }] },
    { name: 'c', published: [{ id: 'x' }, { id: 'y' }] },
    { name: 'd', published: [{ id: 'x' }, { id: 'y' }] },
  ];
  assert.deepEqual(defectSignature(perApp), { id: "x", share: 0.5, apps: 4, note: "one CVE accounts for most published rows across apps \u2014 a defect signature of the matcher or data, not a fleet in crisis; treat as undetermined until examined" });
});

test('returns null when no id reaches half the rows across three or more apps', () => {
  const perApp = [
    { name: 'a', published: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] },
    { name: 'b', published: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] },
    { name: 'c', published: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] },
  ];
  assert.equal(defectSignature(perApp), null);
});

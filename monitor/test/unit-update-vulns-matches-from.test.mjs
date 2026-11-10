// Maps grype match entries to normalized vulnerability records, dropping rows without id and component (monitor/update-vulns.mjs matchesFrom).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesFrom } from '../update-vulns.mjs';

test('returns an empty array when the document has no matches property', () => {
  assert.deepEqual(matchesFrom({}), []);
});

test('returns an empty array when the matches array is empty', () => {
  assert.deepEqual(matchesFrom({ matches: [] }), []);
});

test('returns an empty array when a match lacks both id and component', () => {
  assert.deepEqual(matchesFrom({ matches: [{ vulnerability: {}, artifact: {} }] }), []);
});

test('returns an empty array when a match has an id but no component', () => {
  assert.deepEqual(matchesFrom({ matches: [{ vulnerability: { id: 'CVE-1' }, artifact: {} }] }), []);
});

test('returns an empty array when a match has a component but no id', () => {
  assert.deepEqual(matchesFrom({ matches: [{ vulnerability: {}, artifact: { name: 'pkg' } }] }), []);
});

test('normalizes a match with a fix that has no versions array', () => {
  assert.deepEqual(matchesFrom({ matches: [{ vulnerability: { id: 'CVE-1', severity: 'HIGH', fix: { state: 'fixed' } }, artifact: { name: 'pkg', version: '1.0.0', type: 'npm', id: 'pkg@1.0.0' }, matchDetails: [{ type: 'exact' }, { type: 'range' }] }] }), [{ id: "CVE-1", severity: "HIGH", component: "pkg", componentVersion: "1.0.0", componentType: "npm", artifactId: "pkg@1.0.0", matchTypes: ["exact", "range"], fixVersions: [], fixState: "fixed" }]);
});

test('normalizes a match with a fix that has a versions array', () => {
  assert.deepEqual(matchesFrom({ matches: [{ vulnerability: { id: 'CVE-2', severity: 'CRITICAL', fix: { versions: ['2.0.0', '2.1.0'], state: 'fixed' } }, artifact: { name: 'lib', version: '1.5.0', type: 'brew', id: 'lib@1.5.0' }, matchDetails: [{ type: 'exact' }] }] }), [{ id: "CVE-2", severity: "CRITICAL", component: "lib", componentVersion: "1.5.0", componentType: "brew", artifactId: "lib@1.5.0", matchTypes: ["exact"], fixVersions: ["2.0.0", "2.1.0"], fixState: "fixed" }]);
});

test('normalizes a match with no fix and no matchDetails', () => {
  assert.deepEqual(matchesFrom({ matches: [{ vulnerability: { id: 'CVE-3', severity: 'LOW' }, artifact: { name: 'tool', version: '0.1.0', type: 'npm', id: 'tool@0.1.0' } }] }), [{ id: "CVE-3", severity: "LOW", component: "tool", componentVersion: "0.1.0", componentType: "npm", artifactId: "tool@0.1.0", matchTypes: [], fixVersions: [], fixState: null }]);
});

test('filters out matchDetails entries with a null type', () => {
  assert.deepEqual(matchesFrom({ matches: [{ vulnerability: { id: 'CVE-4', severity: 'MEDIUM' }, artifact: { name: 'app', version: '3.0.0', type: 'npm', id: 'app@3.0.0' }, matchDetails: [{ type: 'exact' }, { type: null }, { type: 'range' }] }] }), [{ id: "CVE-4", severity: "MEDIUM", component: "app", componentVersion: "3.0.0", componentType: "npm", artifactId: "app@3.0.0", matchTypes: ["exact", "range"], fixVersions: [], fixState: null }]);
});

test('normalizes multiple matches and filters out incomplete ones', () => {
  assert.deepEqual(matchesFrom({ matches: [{ vulnerability: { id: 'CVE-5', severity: 'HIGH', fix: { versions: ['1.1.0'], state: 'fixed' } }, artifact: { name: 'a', version: '1.0.0', type: 'npm', id: 'a@1.0.0' }, matchDetails: [{ type: 'exact' }] }, { vulnerability: { id: null, severity: 'LOW' }, artifact: { name: 'b', version: '2.0.0', type: 'brew', id: 'b@2.0.0' }, matchDetails: [] }, { vulnerability: { id: 'CVE-6', severity: 'CRITICAL' }, artifact: { name: 'c', version: '3.0.0', type: 'npm', id: 'c@3.0.0' }, matchDetails: [{ type: 'range' }] }] }), [{ id: "CVE-5", severity: "HIGH", component: "a", componentVersion: "1.0.0", componentType: "npm", artifactId: "a@1.0.0", matchTypes: ["exact"], fixVersions: ["1.1.0"], fixState: "fixed" }, { id: "CVE-6", severity: "CRITICAL", component: "c", componentVersion: "3.0.0", componentType: "npm", artifactId: "c@3.0.0", matchTypes: ["range"], fixVersions: [], fixState: null }]);
});

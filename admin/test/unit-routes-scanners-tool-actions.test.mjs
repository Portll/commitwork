// Computes the install/uninstall/reinstall actions for a tool based on its provenance and catalogue entry (admin/routes/scanners.mjs toolActions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolActions } from '../routes/scanners.mjs';

test('returns empty array when tool is not present and no catalog entry exists', () => {
  const prov = { present: false };
  const result = toolActions(prov, null);
  assert.deepEqual(result, []);
});

test('returns empty array when tool is not present and catalog entry has no available managers', () => {
  const prov = { present: false };
  const catalogEntry = { npm: 'eslint' };
  const onPath = (b) => false;
  const result = toolActions(prov, catalogEntry, { onPath });
  assert.deepEqual(result, []);
});

test('returns empty array when tool is present but package name is invalid', () => {
  const prov = { present: true, manager: 'npm', pkg: 'invalid pkg name!' };
  const result = toolActions(prov, null);
  assert.deepEqual(result, []);
});

test('returns reinstall and uninstall actions when tool is present with valid package', () => {
  const prov = { present: true, manager: 'npm', pkg: 'eslint' };
  const result = toolActions(prov, null);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { verb: 'reinstall', manager: 'npm', argv: ['npm', 'install', '-g', 'eslint'] });
  assert.deepEqual(result[1], { verb: 'uninstall', manager: 'npm', argv: ['npm', 'uninstall', '-g', 'eslint'] });
});

test('returns install action when tool is not present and manager is on path', () => {
  const prov = { present: false };
  const catalogEntry = { npm: 'eslint' };
  const onPath = (b) => b === 'npm';
  const result = toolActions(prov, catalogEntry, { onPath });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { verb: 'install', manager: 'npm', argv: ['npm', 'install', '-g', 'eslint'] });
});

test('returns install actions for multiple managers in install order', () => {
  const prov = { present: false };
  const catalogEntry = { brew: 'jq', npm: 'eslint', pipx: 'black' };
  const onPath = (b) => ['brew', 'npm', 'pipx'].includes(b);
  const result = toolActions(prov, catalogEntry, { onPath });
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { verb: 'install', manager: 'brew', argv: ['brew', 'install', 'jq'] });
  assert.deepEqual(result[1], { verb: 'install', manager: 'pipx', argv: ['pipx', 'install', 'black'] });
  assert.deepEqual(result[2], { verb: 'install', manager: 'npm', argv: ['npm', 'install', '-g', 'eslint'] });
});

test('skips managers not on path when tool is not present', () => {
  const prov = { present: false };
  const catalogEntry = { brew: 'jq', npm: 'eslint' };
  const onPath = (b) => b === 'npm';
  const result = toolActions(prov, catalogEntry, { onPath });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], { verb: 'install', manager: 'npm', argv: ['npm', 'install', '-g', 'eslint'] });
});

test('uses catalog entry package when prov.pkg is missing', () => {
  const prov = { present: true, manager: 'npm' };
  const catalogEntry = { npm: 'eslint' };
  const result = toolActions(prov, catalogEntry);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { verb: 'reinstall', manager: 'npm', argv: ['npm', 'install', '-g', 'eslint'] });
  assert.deepEqual(result[1], { verb: 'uninstall', manager: 'npm', argv: ['npm', 'uninstall', '-g', 'eslint'] });
});

test('handles cargo manager with locked flag in reinstall', () => {
  const prov = { present: true, manager: 'cargo', pkg: 'ripgrep' };
  const result = toolActions(prov, null);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { verb: 'reinstall', manager: 'cargo', argv: ['cargo', 'install', '--force', 'ripgrep', '--locked'] });
  assert.deepEqual(result[1], { verb: 'uninstall', manager: 'cargo', argv: ['cargo', 'uninstall', 'ripgrep'] });
});

test('handles docker manager with pull and image rm', () => {
  const prov = { present: true, manager: 'docker', pkg: 'node:22-alpine' };
  const result = toolActions(prov, null);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { verb: 'reinstall', manager: 'docker', argv: ['docker', 'pull', 'node:22-alpine'] });
  assert.deepEqual(result[1], { verb: 'uninstall', manager: 'docker', argv: ['docker', 'image', 'rm', 'node:22-alpine'] });
});

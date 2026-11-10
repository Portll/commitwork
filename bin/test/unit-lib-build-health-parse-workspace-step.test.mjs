// Builds the workspace materialise step command (bin/lib/build-health-parse.mjs workspaceStep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceStep } from '../lib/build-health-parse.mjs';

test('returns the materialise phase name', () => {
  const r = workspaceStep();
  assert.equal(r.name, "materialise");
});

test('uses the default source, destination, excludes, and tar path in the command', () => {
  const r = workspaceStep();
  assert.equal(r.cmd, "mkdir -p /w && (cd /src && tar -cf - --exclude=node_modules --exclude=target --exclude=.gradle --exclude=.venv --exclude=venv --exclude=__pycache__ --exclude=coverage .) > /tmp/cw-workspace.tar && tar -C /w -xf /tmp/cw-workspace.tar && rm -f /tmp/cw-workspace.tar");
});

test('uses the provided source, destination, excludes, and tar path in the command', () => {
  const r = workspaceStep({ src: '/a', dst: '/b', excludes: ['x', 'y'], tarPath: '/t' });
  assert.equal(r.cmd, "mkdir -p /b && (cd /a && tar -cf - --exclude=x --exclude=y .) > /t && tar -C /b -xf /t && rm -f /t");
});

test('joins multiple excludes with spaces in the tar command', () => {
  const r = workspaceStep({ excludes: ['a', 'b', 'c'] });
  assert.equal(r.cmd, "mkdir -p /w && (cd /src && tar -cf - --exclude=a --exclude=b --exclude=c .) > /tmp/cw-workspace.tar && tar -C /w -xf /tmp/cw-workspace.tar && rm -f /tmp/cw-workspace.tar");
});

test('handles a single exclude entry', () => {
  const r = workspaceStep({ excludes: ['only'] });
  assert.equal(r.cmd, "mkdir -p /w && (cd /src && tar -cf - --exclude=only .) > /tmp/cw-workspace.tar && tar -C /w -xf /tmp/cw-workspace.tar && rm -f /tmp/cw-workspace.tar");
});

test('handles an empty excludes array', () => {
  const r = workspaceStep({ excludes: [] });
  assert.equal(r.cmd, "mkdir -p /w && (cd /src && tar -cf -  .) > /tmp/cw-workspace.tar && tar -C /w -xf /tmp/cw-workspace.tar && rm -f /tmp/cw-workspace.tar");
});

test('returns the same object shape for minimal input', () => {
  const r = workspaceStep({});
  assert.deepEqual(r, { name: "materialise", cmd: "mkdir -p /w && (cd /src && tar -cf - --exclude=node_modules --exclude=target --exclude=.gradle --exclude=.venv --exclude=venv --exclude=__pycache__ --exclude=coverage .) > /tmp/cw-workspace.tar && tar -C /w -xf /tmp/cw-workspace.tar && rm -f /tmp/cw-workspace.tar" });
});

test('returns the same object shape for undefined input', () => {
  const r = workspaceStep(undefined);
  assert.deepEqual(r, { name: "materialise", cmd: "mkdir -p /w && (cd /src && tar -cf - --exclude=node_modules --exclude=target --exclude=.gradle --exclude=.venv --exclude=venv --exclude=__pycache__ --exclude=coverage .) > /tmp/cw-workspace.tar && tar -C /w -xf /tmp/cw-workspace.tar && rm -f /tmp/cw-workspace.tar" });
});

// Validates a capabilities document against the interim contract (lib/cobolwork-resolve.mjs capabilitiesProblem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesProblem } from '../cobolwork-resolve.mjs';

test('returns null for a valid document with no needs', () => {
  const doc = {
    tool: 'cobolwork-capabilities',
    schemaVersion: 1,
    identity: { version: 'cobolwork/v1' }
  };
  assert.equal(capabilitiesProblem(doc), null);
});

test('returns a message when the document is null', () => {
  assert.equal(capabilitiesProblem(null), 'it wrote no capabilities document');
});

test('returns a message when the document is an array', () => {
  assert.equal(capabilitiesProblem([]), 'it wrote no capabilities document');
});

test('returns a message when the tool field is wrong', () => {
  const doc = {
    tool: 'wrong-tool',
    schemaVersion: 1,
    identity: { version: 'cobolwork/v1' }
  };
  assert.equal(capabilitiesProblem(doc), 'it wrote "wrong-tool", not cobolwork-capabilities');
});

test('returns a message when the schemaVersion is wrong', () => {
  const doc = {
    tool: 'cobolwork-capabilities',
    schemaVersion: 2,
    identity: { version: 'cobolwork/v1' }
  };
  assert.equal(capabilitiesProblem(doc), 'its capabilities schemaVersion is 2, and commitwork reads only 1');
});

test('returns a message when the identity version is wrong', () => {
  const doc = {
    tool: 'cobolwork-capabilities',
    schemaVersion: 1,
    identity: { version: 'cobolwork/v2' }
  };
  assert.equal(capabilitiesProblem(doc), 'its fingerprint identity is "cobolwork/v2", and commitwork reads only cobolwork/v1');
});

test('returns a message when a required command is missing', () => {
  const doc = {
    tool: 'cobolwork-capabilities',
    schemaVersion: 1,
    identity: { version: 'cobolwork/v1' },
    commands: {}
  };
  const needs = { scan: ['--json'] };
  assert.equal(capabilitiesProblem(doc, { needs }), 'it has no scan command');
});

test('returns a message when a command lacks required options', () => {
  const doc = {
    tool: 'cobolwork-capabilities',
    schemaVersion: 1,
    identity: { version: 'cobolwork/v1' },
    commands: {
      scan: { options: ['--other'] }
    }
  };
  const needs = { scan: ['--json', '--verbose'] };
  assert.equal(capabilitiesProblem(doc, { needs }), 'its scan takes no --json, --verbose');
});

test('returns null when all required options are present', () => {
  const doc = {
    tool: 'cobolwork-capabilities',
    schemaVersion: 1,
    identity: { version: 'cobolwork/v1' },
    commands: {
      scan: { options: ['--json', '--verbose', '--extra'] }
    }
  };
  const needs = { scan: ['--json', '--verbose'] };
  assert.equal(capabilitiesProblem(doc, { needs }), null);
});

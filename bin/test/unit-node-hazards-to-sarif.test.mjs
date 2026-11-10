// Converts scan findings and suppressed items into a SARIF 2.1.0 report object (bin/node-hazards.mjs toSarif).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSarif } from '../node-hazards.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns the SARIF schema and version fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const r = toSarif({ findings: [] });
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ properties: { suppressedCount: 0 }, tool: { driver: { name: "commitwork-node-hazards", informationUri: "https://commitwork.portll.net", rules: [] } }, results: [] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports zero suppressed count when no items are suppressed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const r = toSarif({ findings: [] });
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ properties: { suppressedCount: 0 }, tool: { driver: { name: "commitwork-node-hazards", informationUri: "https://commitwork.portll.net", rules: [] } }, results: [] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('lists each unique rule id in the tool driver rules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const r = toSarif({ findings: [{ ruleId: 'node/weak-hash', level: 'note', message: 'm', path: 'a.js', line: 1 }] });
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ properties: { suppressedCount: 0 }, tool: { driver: { name: "commitwork-node-hazards", informationUri: "https://commitwork.portll.net", rules: [{ id: "node/weak-hash" }] } }, results: [{ ruleId: "node/weak-hash", level: "note", message: { text: "m" }, locations: [{ physicalLocation: { artifactLocation: { uri: "a.js" }, region: { startLine: 1 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deduplicates rule ids when the same rule fires multiple times', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const r = toSarif({ findings: [
      { ruleId: 'node/weak-hash', level: 'note', message: 'm1', path: 'a.js', line: 1 },
      { ruleId: 'node/weak-hash', level: 'note', message: 'm2', path: 'b.js', line: 2 },
    ] });
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ properties: { suppressedCount: 0 }, tool: { driver: { name: "commitwork-node-hazards", informationUri: "https://commitwork.portll.net", rules: [{ id: "node/weak-hash" }] } }, results: [{ ruleId: "node/weak-hash", level: "note", message: { text: "m1" }, locations: [{ physicalLocation: { artifactLocation: { uri: "a.js" }, region: { startLine: 1 } } }] }, { ruleId: "node/weak-hash", level: "note", message: { text: "m2" }, locations: [{ physicalLocation: { artifactLocation: { uri: "b.js" }, region: { startLine: 2 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps each finding to a SARIF result with location and message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const r = toSarif({ findings: [{ ruleId: 'node/tls-verification-disabled', level: 'error', message: 'bad', path: 'src/x.js', line: 42 }] });
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ properties: { suppressedCount: 0 }, tool: { driver: { name: "commitwork-node-hazards", informationUri: "https://commitwork.portll.net", rules: [{ id: "node/tls-verification-disabled" }] } }, results: [{ ruleId: "node/tls-verification-disabled", level: "error", message: { text: "bad" }, locations: [{ physicalLocation: { artifactLocation: { uri: "src/x.js" }, region: { startLine: 42 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts suppressed items in run properties without placing them in results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const r = toSarif({
      findings: [{ ruleId: 'node/weak-hash', level: 'note', message: 'm', path: 'a.js', line: 1 }],
      suppressed: [
        { ruleId: 'node/weak-hash', level: 'note', message: 'm', path: 'b.js', line: 2, suppression: { marker: 'cw-hazards-ignore', justification: 'x', ownLine: true } },
        { ruleId: 'node/cookie-flag-downgrade', level: 'warning', message: 'm', path: 'c.js', line: 3, suppression: { marker: 'cw-hazards-ignore', justification: 'y', ownLine: false } },
      ],
    });
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ properties: { suppressedCount: 2 }, tool: { driver: { name: "commitwork-node-hazards", informationUri: "https://commitwork.portll.net", rules: [{ id: "node/weak-hash" }] } }, results: [{ ruleId: "node/weak-hash", level: "note", message: { text: "m" }, locations: [{ physicalLocation: { artifactLocation: { uri: "a.js" }, region: { startLine: 1 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('defaults suppressed to an empty array when the key is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const r = toSarif({ findings: [{ ruleId: 'node/vue-v-html', level: 'warning', message: 'm', path: 'v.vue', line: 7 }] });
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ properties: { suppressedCount: 0 }, tool: { driver: { name: "commitwork-node-hazards", informationUri: "https://commitwork.portll.net", rules: [{ id: "node/vue-v-html" }] } }, results: [{ ruleId: "node/vue-v-html", level: "warning", message: { text: "m" }, locations: [{ physicalLocation: { artifactLocation: { uri: "v.vue" }, region: { startLine: 7 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

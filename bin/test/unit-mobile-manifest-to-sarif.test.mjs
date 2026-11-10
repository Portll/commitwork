// Converts a scan result into a SARIF 2.1.0 report object (bin/mobile-manifest.mjs toSarif).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toSarif } from '../mobile-manifest.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('maps a single error finding to a SARIF result with its rule, level, message, and location', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const input = { manifests: 1, findings: [{ rule: 'mobile/debuggable', level: 'error', file: 'a/AndroidManifest.xml', line: 3, message: 'debuggable is true' }] };
    const r = toSarif(input);
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ tool: { driver: { name: "commitwork-mobile-manifest", informationUri: "https://github.com/Portll/commitwork", rules: [{ id: "mobile/debuggable", name: "mobile/debuggable", shortDescription: { text: "mobile/debuggable" }, properties: { "security-severity": "8.0" } }] } }, properties: { manifestsExamined: 1 }, results: [{ ruleId: "mobile/debuggable", level: "error", message: { text: "debuggable is true" }, locations: [{ physicalLocation: { artifactLocation: { uri: "a/AndroidManifest.xml" }, region: { startLine: 3 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the severity of the first finding for a rule that appears with multiple levels', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const input = { manifests: 2, findings: [
      { rule: 'mobile/exported-no-permission', level: 'error', file: 'a.xml', line: 1, message: 'first' },
      { rule: 'mobile/exported-no-permission', level: 'warning', file: 'b.xml', line: 2, message: 'second' },
    ] };
    const r = toSarif(input);
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ tool: { driver: { name: "commitwork-mobile-manifest", informationUri: "https://github.com/Portll/commitwork", rules: [{ id: "mobile/exported-no-permission", name: "mobile/exported-no-permission", shortDescription: { text: "mobile/exported-no-permission" }, properties: { "security-severity": "8.0" } }] } }, properties: { manifestsExamined: 2 }, results: [{ ruleId: "mobile/exported-no-permission", level: "error", message: { text: "first" }, locations: [{ physicalLocation: { artifactLocation: { uri: "a.xml" }, region: { startLine: 1 } } }] }, { ruleId: "mobile/exported-no-permission", level: "warning", message: { text: "second" }, locations: [{ physicalLocation: { artifactLocation: { uri: "b.xml" }, region: { startLine: 2 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to a default severity when a rule has no matching finding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const input = { manifests: 0, findings: [] };
    const r = toSarif(input);
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ tool: { driver: { name: "commitwork-mobile-manifest", informationUri: "https://github.com/Portll/commitwork", rules: [] } }, properties: { manifestsExamined: 0 }, results: [] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports the SARIF version and schema in the top-level object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const input = { manifests: 0, findings: [] };
    const r = toSarif(input);
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ tool: { driver: { name: "commitwork-mobile-manifest", informationUri: "https://github.com/Portll/commitwork", rules: [] } }, properties: { manifestsExamined: 0 }, results: [] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('records the manifest count in the run properties', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const input = { manifests: 5, findings: [] };
    const r = toSarif(input);
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ tool: { driver: { name: "commitwork-mobile-manifest", informationUri: "https://github.com/Portll/commitwork", rules: [] } }, properties: { manifestsExamined: 5 }, results: [] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deduplicates rules so each unique rule id appears once in the rules array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const input = { manifests: 3, findings: [
      { rule: 'mobile/allow-backup', level: 'warning', file: 'x.xml', line: 1, message: 'm1' },
      { rule: 'mobile/allow-backup', level: 'warning', file: 'y.xml', line: 2, message: 'm2' },
      { rule: 'mobile/cleartext-traffic', level: 'warning', file: 'z.xml', line: 3, message: 'm3' },
    ] };
    const r = toSarif(input);
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ tool: { driver: { name: "commitwork-mobile-manifest", informationUri: "https://github.com/Portll/commitwork", rules: [{ id: "mobile/allow-backup", name: "mobile/allow-backup", shortDescription: { text: "mobile/allow-backup" }, properties: { "security-severity": "5.0" } }, { id: "mobile/cleartext-traffic", name: "mobile/cleartext-traffic", shortDescription: { text: "mobile/cleartext-traffic" }, properties: { "security-severity": "5.0" } }] } }, properties: { manifestsExamined: 3 }, results: [{ ruleId: "mobile/allow-backup", level: "warning", message: { text: "m1" }, locations: [{ physicalLocation: { artifactLocation: { uri: "x.xml" }, region: { startLine: 1 } } }] }, { ruleId: "mobile/allow-backup", level: "warning", message: { text: "m2" }, locations: [{ physicalLocation: { artifactLocation: { uri: "y.xml" }, region: { startLine: 2 } } }] }, { ruleId: "mobile/cleartext-traffic", level: "warning", message: { text: "m3" }, locations: [{ physicalLocation: { artifactLocation: { uri: "z.xml" }, region: { startLine: 3 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sorts rules alphabetically by id in the driver rules array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const input = { manifests: 2, findings: [
      { rule: 'mobile/ats-arbitrary-loads', level: 'error', file: 'a.plist', line: 1, message: 'a' },
      { rule: 'mobile/custom-url-scheme', level: 'note', file: 'b.plist', line: 2, message: 'b' },
      { rule: 'mobile/debuggable', level: 'error', file: 'c.xml', line: 3, message: 'c' },
    ] };
    const r = toSarif(input);
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ tool: { driver: { name: "commitwork-mobile-manifest", informationUri: "https://github.com/Portll/commitwork", rules: [{ id: "mobile/ats-arbitrary-loads", name: "mobile/ats-arbitrary-loads", shortDescription: { text: "mobile/ats-arbitrary-loads" }, properties: { "security-severity": "8.0" } }, { id: "mobile/custom-url-scheme", name: "mobile/custom-url-scheme", shortDescription: { text: "mobile/custom-url-scheme" }, properties: { "security-severity": "2.0" } }, { id: "mobile/debuggable", name: "mobile/debuggable", shortDescription: { text: "mobile/debuggable" }, properties: { "security-severity": "8.0" } }] } }, properties: { manifestsExamined: 2 }, results: [{ ruleId: "mobile/ats-arbitrary-loads", level: "error", message: { text: "a" }, locations: [{ physicalLocation: { artifactLocation: { uri: "a.plist" }, region: { startLine: 1 } } }] }, { ruleId: "mobile/custom-url-scheme", level: "note", message: { text: "b" }, locations: [{ physicalLocation: { artifactLocation: { uri: "b.plist" }, region: { startLine: 2 } } }] }, { ruleId: "mobile/debuggable", level: "error", message: { text: "c" }, locations: [{ physicalLocation: { artifactLocation: { uri: "c.xml" }, region: { startLine: 3 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps each finding to a result with ruleId, level, message text, and physical location', () => {
  const dir = mkdtempSync(join(tmpdir(), 'toSarif-'));
  try {
    const input = { manifests: 1, findings: [
      { rule: 'mobile/implicitly-exported', level: 'warning', file: 'app/AndroidManifest.xml', line: 42, message: 'implicit export' },
      { rule: 'mobile/provider-grant-uri', level: 'warning', file: 'app/AndroidManifest.xml', line: 43, message: 'grant uri' },
    ] };
    const r = toSarif(input);
    assert.deepEqual(r, { $schema: "https://json.schemastore.org/sarif-2.1.0.json", version: "2.1.0", runs: [{ tool: { driver: { name: "commitwork-mobile-manifest", informationUri: "https://github.com/Portll/commitwork", rules: [{ id: "mobile/implicitly-exported", name: "mobile/implicitly-exported", shortDescription: { text: "mobile/implicitly-exported" }, properties: { "security-severity": "5.0" } }, { id: "mobile/provider-grant-uri", name: "mobile/provider-grant-uri", shortDescription: { text: "mobile/provider-grant-uri" }, properties: { "security-severity": "5.0" } }] } }, properties: { manifestsExamined: 1 }, results: [{ ruleId: "mobile/implicitly-exported", level: "warning", message: { text: "implicit export" }, locations: [{ physicalLocation: { artifactLocation: { uri: "app/AndroidManifest.xml" }, region: { startLine: 42 } } }] }, { ruleId: "mobile/provider-grant-uri", level: "warning", message: { text: "grant uri" }, locations: [{ physicalLocation: { artifactLocation: { uri: "app/AndroidManifest.xml" }, region: { startLine: 43 } } }] }] }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

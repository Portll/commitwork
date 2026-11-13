// parses OSV SARIF and optional declared verdict (monitor/dep-findings.mjs parseOsv)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseOsv } from '../dep-findings.mjs';

function writeJson(dir, name, obj) {
  writeFileSync(join(dir, name), JSON.stringify(obj), 'utf8');
}

test('returns state from readSarif when not ok', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseOsv-'));
  try {
    writeJson(dir, 'osv.sarif', { state: 'error', runs: [] });
    const result = parseOsv(dir);
    assert.deepEqual(result, { rows: [], state: "never-ran" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty rows when runs array is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseOsv-'));
  try {
    writeJson(dir, 'osv.sarif', { state: 'ok', runs: [] });
    const result = parseOsv(dir);
    assert.deepEqual(result, { rows: [], state: "never-ran" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing rule properties and defaults cvss to 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseOsv-'));
  try {
    const sarif = {
      state: 'ok',
      runs: [{
        results: [{ ruleId: 'CVE-1234-0001', message: { text: 'pkg@1.0.0' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///path/to/manifest' } } }] }],
        tool: { driver: { rules: [{ id: 'CVE-1234-0001' }] } }
      }]
    };
    writeJson(dir, 'osv.sarif', sarif);
    const result = parseOsv(dir);
    assert.deepEqual(result, { rows: [{ tool: "osv", id: "CVE-1234-0001", cvss: 0, severity: "unknown", malicious: false, package: "", version: "", path: "file:///path/to/manifest", aliases: [], fixed: "", title: "CVE-1234-0001", advisory: "https://osv.dev/vulnerability/CVE-1234-0001" }], state: "ok" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recognises malicious MAL- id and forces crit severity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseOsv-'));
  try {
    const sarif = {
      state: 'ok',
      runs: [{
        results: [{ ruleId: 'MAL-1234-0001', message: { text: 'evil@0.0.1' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///manifest' } } }] }],
        tool: { driver: { rules: [{ id: 'MAL-1234-0001' }] } }
      }]
    };
    writeJson(dir, 'osv.sarif', sarif);
    const result = parseOsv(dir);
    assert.deepEqual(result, { rows: [{ tool: "osv", id: "MAL-1234-0001", cvss: 0, severity: "crit", malicious: true, package: "", version: "", path: "file:///manifest", aliases: [], fixed: "", title: "MAL-1234-0001", advisory: "https://osv.dev/vulnerability/MAL-1234-0001" }], state: "ok" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applies declared verdict to mark row as unknown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseOsv-'));
  try {
    const sarif = {
      state: 'ok',
      runs: [{
        results: [{ ruleId: 'CVE-2022-0001', message: { text: 'pkg@2.0.0' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///manifest' } } }] }],
        tool: { driver: { rules: [{ id: 'CVE-2022-0001' }] } }
      }]
    };
    writeJson(dir, 'osv.sarif', sarif);
    writeJson(dir, 'osv-declared.json', { ran: true, manifests: { 'file:///manifest': { readable: true, resolved: ['pkg@2.0.0'] } } });
    const result = parseOsv(dir);
    assert.deepEqual(result, { rows: [{ tool: "osv", id: "CVE-2022-0001", cvss: 0, severity: "unknown", malicious: false, package: "", version: "", path: "file:///manifest", aliases: [], fixed: "", title: "CVE-2022-0001", advisory: "https://osv.dev/vulnerability/CVE-2022-0001" }], state: "ok" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles rule with deprecatedIds (aliases) array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseOsv-'));
  try {
    const sarif = {
      state: 'ok',
      runs: [{
        results: [{ ruleId: 'CVE-2023-0002', message: { text: 'lib@1.2.3' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///manifest2' } } }] }],
        tool: { driver: { rules: [{ id: 'CVE-2023-0002', deprecatedIds: ['GHSA-xxxx-xxxx-xxxx', 123] }] } }
      }]
    };
    writeJson(dir, 'osv.sarif', sarif);
    const result = parseOsv(dir);
    assert.deepEqual(result, { rows: [{ tool: "osv", id: "CVE-2023-0002", cvss: 0, severity: "unknown", malicious: false, package: "", version: "", path: "file:///manifest2", aliases: ["GHSA-xxxx-xxxx-xxxx"], fixed: "", title: "CVE-2023-0002", advisory: "https://osv.dev/vulnerability/CVE-2023-0002" }], state: "ok" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('processes rule.help text for fixed field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseOsv-'));
  try {
    const sarif = {
      state: 'ok',
      runs: [{
        results: [{ ruleId: 'GHSA-aaaa-bbbb-cccc', message: { text: 'mod@0.1.0' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///mod' } } }] }],
        tool: { driver: { rules: [{ id: 'GHSA-aaaa-bbbb-cccc', help: { text: 'fixed in 0.2.0' } }] } }
      }]
    };
    writeJson(dir, 'osv.sarif', sarif);
    const result = parseOsv(dir);
    assert.deepEqual(result, { rows: [{ tool: "osv", id: "GHSA-aaaa-bbbb-cccc", cvss: 0, severity: "unknown", malicious: false, package: "", version: "", path: "file:///mod", aliases: [], fixed: "", title: "GHSA-aaaa-bbbb-cccc", advisory: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" }], state: "ok" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles missing message text gracefully', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseOsv-'));
  try {
    const sarif = {
      state: 'ok',
      runs: [{
        results: [{ ruleId: 'CVE-2024-0003', locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///none' } } }] }],
        tool: { driver: { rules: [{ id: 'CVE-2024-0003' }] } }
      }]
    };
    writeJson(dir, 'osv.sarif', sarif);
    const result = parseOsv(dir);
    assert.deepEqual(result, { rows: [{ tool: "osv", id: "CVE-2024-0003", cvss: 0, severity: "unknown", malicious: false, package: "", version: "", path: "file:///none", aliases: [], fixed: "", title: "CVE-2024-0003", advisory: "https://osv.dev/vulnerability/CVE-2024-0003" }], state: "ok" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles result with no locations array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'parseOsv-'));
  try {
    const sarif = {
      state: 'ok',
      runs: [{
        results: [{ ruleId: 'CVE-2025-0004', message: { text: 'pkg@3.0.0' } }],
        tool: { driver: { rules: [{ id: 'CVE-2025-0004' }] } }
      }]
    };
    writeJson(dir, 'osv.sarif', sarif);
    const result = parseOsv(dir);
    assert.deepEqual(result, { rows: [{ tool: "osv", id: "CVE-2025-0004", cvss: 0, severity: "unknown", malicious: false, package: "", version: "", path: "", aliases: [], fixed: "", title: "CVE-2025-0004", advisory: "https://osv.dev/vulnerability/CVE-2025-0004" }], state: "ok" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

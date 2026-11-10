// Counts WordPress advisories from a wp-advisories artifact (monitor/extractors/supply-chain.mjs _wpAdvisoriesCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _wpAdvisoriesCounts } from '../extractors/supply-chain.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('maps missing fields to empty strings and normalizes booleans', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpAdvisoriesCounts-'));
  try {
    const artifact = {
      tool: 'wp-advisories',
      summary: { filesScanned: 1, components: { checked: 1, unknownToSource: 0 } },
      findings: [{ rule: 'R1', path: 'p', component: 'c', version: 'v', advisories: 2, kev: true, exploited: true, fixedIn: '1.1', sev: 'high', cwe: 'CWE-1', detail: 'd' }]
    };
    writeFileSync(join(dir, 'a.json'), JSON.stringify(artifact));
    const result = _wpAdvisoriesCounts(dir, 'a.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, filesScanned: 1, checked: 1, unknownToSource: 0, notMeasured: 0, byRule: { R1: { count: 1, sev: "high" } }, findings: [{ rule: "R1", file: "p", component: "c", version: "v", advisories: 2, kev: true, exploited: true, fixedIn: "1.1", sev: "high", cwe: "CWE-1", message: "d" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('treats absent fields as empty strings and false booleans', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpAdvisoriesCounts-'));
  try {
    const artifact = {
      tool: 'wp-advisories',
      summary: { filesScanned: 1, components: { checked: 1, unknownToSource: 0 } },
      findings: [{ rule: 'R1', path: 'p', component: 'c', version: 'v', advisories: 2, kev: false, exploited: false, fixedIn: '1.1', sev: 'high', cwe: 'CWE-1', detail: 'd' }]
    };
    writeFileSync(join(dir, 'a.json'), JSON.stringify(artifact));
    const result = _wpAdvisoriesCounts(dir, 'a.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, filesScanned: 1, checked: 1, unknownToSource: 0, notMeasured: 0, byRule: { R1: { count: 1, sev: "high" } }, findings: [{ rule: "R1", file: "p", component: "c", version: "v", advisories: 2, kev: false, exploited: false, fixedIn: "1.1", sev: "high", cwe: "CWE-1", message: "d" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps null fields to empty strings and false booleans', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpAdvisoriesCounts-'));
  try {
    const artifact = {
      tool: 'wp-advisories',
      summary: { filesScanned: 1, components: { checked: 1, unknownToSource: 0 } },
      findings: [{ rule: null, path: null, component: null, version: null, advisories: 2, kev: null, exploited: null, fixedIn: null, sev: 'high', cwe: null, detail: null }]
    };
    writeFileSync(join(dir, 'a.json'), JSON.stringify(artifact));
    const result = _wpAdvisoriesCounts(dir, 'a.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 0, low: 0, total: 1, ran: true, filesScanned: 1, checked: 1, unknownToSource: 0, notMeasured: 0, byRule: { "": { count: 1, sev: "high" } }, findings: [{ rule: "", file: "", component: "", version: "", advisories: 2, kev: false, exploited: false, fixedIn: "", sev: "high", cwe: "", message: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts components when summary.components is an object', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpAdvisoriesCounts-'));
  try {
    const artifact = {
      tool: 'wp-advisories',
      summary: { filesScanned: 1, components: { checked: 5, unknownToSource: 3 }, notMeasured: ['a', 'b'] },
      findings: [{ rule: 'R1', path: 'p', component: 'c', version: 'v', advisories: 1, kev: false, exploited: false, fixedIn: '', sev: 'low', cwe: '', detail: '' }]
    };
    writeFileSync(join(dir, 'a.json'), JSON.stringify(artifact));
    const result = _wpAdvisoriesCounts(dir, 'a.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, filesScanned: 1, checked: 5, unknownToSource: 3, notMeasured: 2, byRule: { R1: { count: 1, sev: "low" } }, findings: [{ rule: "R1", file: "p", component: "c", version: "v", advisories: 1, kev: false, exploited: false, fixedIn: "", sev: "low", cwe: "", message: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('zeroes component counts when summary.components is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpAdvisoriesCounts-'));
  try {
    const artifact = {
      tool: 'wp-advisories',
      summary: { filesScanned: 1, notMeasured: ['a'] },
      findings: [{ rule: 'R1', path: 'p', component: 'c', version: 'v', advisories: 1, kev: false, exploited: false, fixedIn: '', sev: 'low', cwe: '', detail: '' }]
    };
    writeFileSync(join(dir, 'a.json'), JSON.stringify(artifact));
    const result = _wpAdvisoriesCounts(dir, 'a.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, filesScanned: 1, checked: 0, unknownToSource: 0, notMeasured: 1, byRule: { R1: { count: 1, sev: "low" } }, findings: [{ rule: "R1", file: "p", component: "c", version: "v", advisories: 1, kev: false, exploited: false, fixedIn: "", sev: "low", cwe: "", message: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('zeroes component counts when summary.components is a string', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpAdvisoriesCounts-'));
  try {
    const artifact = {
      tool: 'wp-advisories',
      summary: { filesScanned: 1, components: 'not-an-object', notMeasured: [] },
      findings: [{ rule: 'R1', path: 'p', component: 'c', version: 'v', advisories: 1, kev: false, exploited: false, fixedIn: '', sev: 'low', cwe: '', detail: '' }]
    };
    writeFileSync(join(dir, 'a.json'), JSON.stringify(artifact));
    const result = _wpAdvisoriesCounts(dir, 'a.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, filesScanned: 1, checked: 0, unknownToSource: 0, notMeasured: 0, byRule: { R1: { count: 1, sev: "low" } }, findings: [{ rule: "R1", file: "p", component: "c", version: "v", advisories: 1, kev: false, exploited: false, fixedIn: "", sev: "low", cwe: "", message: "" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when filesScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpAdvisoriesCounts-'));
  try {
    const artifact = {
      tool: 'wp-advisories',
      summary: { filesScanned: 0, voidReason: 'no source' },
      findings: []
    };
    writeFileSync(join(dir, 'a.json'), JSON.stringify(artifact));
    const result = _wpAdvisoriesCounts(dir, 'a.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true, nosrcReason: "no source" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_wpAdvisoriesCounts-'));
  try {
    const result = _wpAdvisoriesCounts(dir, 'missing.json');
    assert.deepEqual(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

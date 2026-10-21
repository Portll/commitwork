// Maps a tool report artifact to a severity bucket and a noscan flag (bin/audit.mjs classifyFindings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFindings } from '../audit.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns noscan when the declared report format has no registered handler', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const t = { id: 'testssl', report: 'json' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, true);
    assert.deepEqual(out.sev, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    assert.equal(out.note, "noscan \u2014 no parser for report format 'json' (tool 'testssl') \u2014 classified noscan, not scanned-clean");
    assert.equal(out.reason, "no parser for report format 'json' (tool 'testssl') \u2014 classified noscan, not scanned-clean");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when a sarif report file is missing from the report directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const t = { id: 'semgrep', report: 'sarif' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, true);
    assert.equal(out.reason, 'no .sarif report written');
    assert.equal(out.note, 'noscan \u2014 no .sarif report written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when the sarif file is corrupt JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'report.sarif');
    writeFileSync(p, 'not json');
    const t = { id: 'semgrep', report: 'sarif' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, true);
    assert.equal(out.reason, 'unparseable sarif (corrupt JSON)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when the sarif document has no runs array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'report.sarif');
    writeFileSync(p, JSON.stringify({ version: '2.1.0' }));
    const t = { id: 'semgrep', report: 'sarif' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, true);
    assert.equal(out.reason, 'not a sarif document \u2014 no runs[]');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when the tool reported a failure inside the sarif document', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'report.sarif');
    writeFileSync(p, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'x', rules: [] } }, results: [], invocations: [{ executionSuccessful: false, message: { text: 'boom' } }] }], $schema: 'https://json.schemastore.org/sarif-2.1.0.json' }));
    const t = { id: 'semgrep', report: 'sarif' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, true);
    assert.match(out.reason, /^tool reported failure \u2014 /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a clean zero severity when the sarif document has runs but no results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'report.sarif');
    writeFileSync(p, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'x', rules: [] } }, results: [] }] }));
    const t = { id: 'semgrep', report: 'sarif' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    assert.equal(out.note, '0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buckets a sarif finding as critical when its security-severity is 9 or higher', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'report.sarif');
    writeFileSync(p, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'x', rules: [{ id: 'R1', properties: { 'security-severity': '9.8' } }] } }, results: [{ ruleId: 'R1' }] }] }));
    const t = { id: 'semgrep', report: 'sarif' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 1, high: 0, medium: 0, low: 0, info: 0 });
    assert.equal(out.note, '1 findings');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buckets a sarif finding as high when its security-severity is between 7 and 9', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'report.sarif');
    writeFileSync(p, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'x', rules: [{ id: 'R1', properties: { 'security-severity': '7.5' } }] } }, results: [{ ruleId: 'R1' }] }] }));
    const t = { id: 'semgrep', report: 'sarif' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 1, medium: 0, low: 0, info: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buckets a sarif finding as medium when its security-severity is between 4 and 7', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'report.sarif');
    writeFileSync(p, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'x', rules: [{ id: 'R1', properties: { 'security-severity': '4.0' } }] } }, results: [{ ruleId: 'R1' }] }] }));
    const t = { id: 'semgrep', report: 'sarif' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 0, medium: 1, low: 0, info: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buckets a sarif finding as low when its security-severity is below 4', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'report.sarif');
    writeFileSync(p, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'x', rules: [{ id: 'R1', properties: { 'security-severity': '3.9' } }] } }, results: [{ ruleId: 'R1' }] }] }));
    const t = { id: 'semgrep', report: 'sarif' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 0, medium: 0, low: 1, info: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buckets a secrets-category sarif finding as high when no security-severity is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'report.sarif');
    writeFileSync(p, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'x', rules: [{ id: 'R1' }] } }, results: [{ ruleId: 'R1', level: 'warning' }] }] }));
    const t = { id: 'gitleaks', report: 'sarif', category: 'secrets' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 1, medium: 0, low: 0, info: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buckets a non-secrets sarif finding by its level when no security-severity is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'report.sarif');
    writeFileSync(p, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'x', rules: [{ id: 'R1' }] } }, results: [{ ruleId: 'R1', level: 'error' }] }] }));
    const t = { id: 'semgrep', report: 'sarif' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 1, medium: 0, low: 0, info: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when the sbom report file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const t = { id: 'syft', report: 'sbom' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, true);
    assert.equal(out.reason, 'no sbom report written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when the sbom json is corrupt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'sbom.json');
    writeFileSync(p, 'not json');
    const t = { id: 'syft', report: 'sbom' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, true);
    assert.equal(out.reason, 'unparseable sbom (corrupt JSON)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when the sbom has neither bomFormat nor a components array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'sbom.json');
    writeFileSync(p, JSON.stringify({ foo: 'bar' }));
    const t = { id: 'syft', report: 'sbom' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, true);
    assert.equal(out.reason, 'sbom has no bomFormat/components \u2014 not a CycloneDX document');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports zero components when the sbom is a CycloneDX document with no components key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'sbom.json');
    writeFileSync(p, JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5' }));
    const t = { id: 'syft', report: 'sbom' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    assert.equal(out.note, 'SBOM: 0 components');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports the component count when the sbom has a components array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'sbom.json');
    writeFileSync(p, JSON.stringify({ bomFormat: 'CycloneDX', components: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }));
    const t = { id: 'syft', report: 'sbom' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.equal(out.note, 'SBOM: 3 components');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when the nuclei report file is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const t = { id: 'nuclei', report: 'json' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, true);
    assert.equal(out.reason, 'no nuclei report written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a clean zero when the nuclei report is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'nuclei.jsonl');
    writeFileSync(p, '');
    const t = { id: 'nuclei', report: 'json' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    assert.equal(out.note, '0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns noscan when the nuclei report has no parseable JSONL lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'nuclei.jsonl');
    writeFileSync(p, 'not json\nalso not json\n');
    const t = { id: 'nuclei', report: 'json' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, true);
    assert.equal(out.reason, 'nuclei report had no parseable JSONL lines');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a nuclei finding as live when its response status is below 400', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'nuclei.jsonl');
    writeFileSync(p, JSON.stringify({ info: { severity: 'high' }, response: 'HTTP/1.1 200 OK\nbody' }) + '\n');
    const t = { id: 'nuclei', report: 'json' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 1, medium: 0, low: 0, info: 0 });
    assert.equal(out.note, '1 live finding');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a nuclei finding as live when it has no HTTP status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'nuclei.jsonl');
    writeFileSync(p, JSON.stringify({ info: { severity: 'medium' }, response: 'no http here' }) + '\n');
    const t = { id: 'nuclei', report: 'json' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 0, medium: 1, low: 0, info: 0 });
    assert.equal(out.note, '1 live finding');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a nuclei finding as unconfirmed when its response status is 4xx or 5xx', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'nuclei.jsonl');
    writeFileSync(p, JSON.stringify({ info: { severity: 'critical' }, response: 'HTTP/1.1 500 Internal Server Error' }) + '\n');
    const t = { id: 'nuclei', report: 'json' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    assert.equal(out.note, '0 live findings (+1 unconfirmed: non-2xx response)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maps a nuclei finding with unknown severity to the info bucket', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifyFindings-'));
  try {
    const p = join(dir, 'nuclei.jsonl');
    writeFileSync(p, JSON.stringify({ info: { severity: 'weird' }, response: 'HTTP/1.1 200 OK' }) + '\n');
    const t = { id: 'nuclei', report: 'json' };
    const out = classifyFindings(t, dir);
    assert.equal(out.noscan, false);
    assert.deepEqual(out.sev, { critical: 0, high: 0, medium: 0, low: 0, info: 1 });
    assert.equal(out.note, '1 live finding');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

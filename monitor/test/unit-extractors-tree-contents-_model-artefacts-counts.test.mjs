// Counts model artefacts from a JSON report file (monitor/extractors/tree-contents.mjs _modelArtefactsCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _modelArtefactsCounts } from '../extractors/tree-contents.mjs';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_modelArtefactsCounts-'));
  try {
    const result = _modelArtefactsCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when the file is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), '_modelArtefactsCounts-'));
  try {
    writeFileSync(join(dir, 'empty.json'), '');
    const result = _modelArtefactsCounts(dir, 'empty.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_modelArtefactsCounts-'));
  try {
    writeFileSync(join(dir, 'bad.json'), 'not json');
    const result = _modelArtefactsCounts(dir, 'bad.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable when the tool field is wrong', () => {
  const dir = mkdtempSync(join(tmpdir(), '_modelArtefactsCounts-'));
  try {
    const data = { tool: 'wrong', summary: { filesScanned: 1 }, findings: [] };
    writeFileSync(join(dir, 'wrong.json'), JSON.stringify(data));
    const result = _modelArtefactsCounts(dir, 'wrong.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, unparseable: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns nosrc when filesScanned is zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_modelArtefactsCounts-'));
  try {
    const data = { tool: 'model-artefacts', summary: { filesScanned: 0 }, findings: [] };
    writeFileSync(join(dir, 'zero.json'), JSON.stringify(data));
    const result = _modelArtefactsCounts(dir, 'zero.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, nosrc: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts findings with valid severity', () => {
  const dir = mkdtempSync(join(tmpdir(), '_modelArtefactsCounts-'));
  try {
    const data = {
      tool: 'model-artefacts',
      summary: { filesScanned: 5 },
      findings: [
        { rule: 'pickle', path: 'a.py', line: 10, sev: 'high', cwe: 'CWE-502', detail: 'bad pickle' },
        { rule: 'pickle', path: 'b.py', line: 20, sev: 'med', cwe: 'CWE-502', detail: 'another' }
      ]
    };
    writeFileSync(join(dir, 'valid.json'), JSON.stringify(data));
    const result = _modelArtefactsCounts(dir, 'valid.json');
    assert.deepEqual(result, { crit: 0, high: 1, med: 1, low: 0, total: 2, ran: true, filesScanned: 5, byRule: { pickle: { count: 2, sev: "high" } }, findings: [{ rule: "pickle", file: "a.py", line: 10, sev: "high", cwe: "CWE-502", message: "bad pickle" }, { rule: "pickle", file: "b.py", line: 20, sev: "med", cwe: "CWE-502", message: "another" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts undetermined when severity is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), '_modelArtefactsCounts-'));
  try {
    const data = {
      tool: 'model-artefacts',
      summary: { filesScanned: 3 },
      findings: [
        { rule: 'safetensors', path: 'model.safetensors', line: 1, cwe: '', detail: 'header issue' }
      ]
    };
    writeFileSync(join(dir, 'undetermined.json'), JSON.stringify(data));
    const result = _modelArtefactsCounts(dir, 'undetermined.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 0, total: 0, ran: true, filesScanned: 3, undetermined: 1, byRule: { safetensors: { count: 1, sev: "" } }, findings: [{ rule: "safetensors", file: "model.safetensors", line: 1, sev: "", cwe: "", message: "header issue" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes partial read info when unreadable or oversize is non-zero', () => {
  const dir = mkdtempSync(join(tmpdir(), '_modelArtefactsCounts-'));
  try {
    const data = {
      tool: 'model-artefacts',
      summary: { filesScanned: 10, unreadable: 2, skippedOversize: 1 },
      findings: [
        { rule: 'hub', path: 'config.json', line: 5, sev: 'low', cwe: '', detail: 'hub load' }
      ]
    };
    writeFileSync(join(dir, 'partial.json'), JSON.stringify(data));
    const result = _modelArtefactsCounts(dir, 'partial.json');
    assert.deepEqual(result, { crit: 0, high: 0, med: 0, low: 1, total: 1, ran: true, filesScanned: 10, byRule: { hub: { count: 1, sev: "low" } }, partial: { unreadable: 2, skippedOversize: 1, note: "2 file(s) had a magic the walker could not read and 1 exceeded CW_MODEL_MAX_BYTES; none of them was judged, so these counts are a floor." }, findings: [{ rule: "hub", file: "config.json", line: 5, sev: "low", cwe: "", message: "hub load" }] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

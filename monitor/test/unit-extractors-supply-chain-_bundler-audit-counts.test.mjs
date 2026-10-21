// Counts bundler-audit unpatched_gem advisories by criticality bucket (monitor/extractors/supply-chain.mjs _bundlerAuditCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _bundlerAuditCounts } from '../extractors/supply-chain.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns null when the file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bundlerAuditCounts-'));
  try {
    const result = _bundlerAuditCounts(dir, 'missing.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns null when the file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bundlerAuditCounts-'));
  try {
    const f = join(dir, 'bad.json');
    writeFileSync(f, 'not json');
    const result = _bundlerAuditCounts(dir, 'bad.json');
    assert.equal(result, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns unparseable true when results is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bundlerAuditCounts-'));
  try {
    const f = join(dir, 'noarr.json');
    writeFileSync(f, JSON.stringify({ results: 'nope' }));
    const result = _bundlerAuditCounts(dir, 'noarr.json');
    assert.equal(result.ran, true);
    assert.equal(result.unparseable, true);
    assert.equal(result.total, 0);
    assert.equal(result.low, 0);
    assert.equal(result.med, 0);
    assert.equal(result.high, 0);
    assert.equal(result.crit, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns zero counts with ran true when results is an empty array', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bundlerAuditCounts-'));
  try {
    const f = join(dir, 'empty.json');
    writeFileSync(f, JSON.stringify({ results: [] }));
    const result = _bundlerAuditCounts(dir, 'empty.json');
    assert.equal(result.ran, true);
    assert.equal(result.total, 0);
    assert.equal(result.low, 0);
    assert.equal(result.med, 0);
    assert.equal(result.high, 0);
    assert.equal(result.crit, 0);
    assert.equal(result.undetermined, undefined);
    assert.equal(result.unparseable, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a critical unpatched_gem advisory into the crit bucket', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bundlerAuditCounts-'));
  try {
    const f = join(dir, 'crit.json');
    const data = {
      results: [{
        type: 'unpatched_gem',
        advisory: { id: 'GHSA-1', criticality: 'critical', title: 'Bad gem', patched_versions: ['1.0.0'] },
        gem: { name: 'badgem', version: '0.9.0' }
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _bundlerAuditCounts(dir, 'crit.json');
    assert.equal(result.crit, 1);
    assert.equal(result.total, 1);
    assert.equal(result.low, 0);
    assert.equal(result.med, 0);
    assert.equal(result.high, 0);
    assert.equal(result.undetermined, undefined);
    assert.equal(result.ran, true);
    assert.equal(result.unparseable, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a high unpatched_gem advisory into the high bucket', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bundlerAuditCounts-'));
  try {
    const f = join(dir, 'high.json');
    const data = {
      results: [{
        type: 'unpatched_gem',
        advisory: { id: 'GHSA-2', criticality: 'high', title: 'High issue' },
        gem: { name: 'gem2', version: '2.0.0' }
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _bundlerAuditCounts(dir, 'high.json');
    assert.equal(result.high, 1);
    assert.equal(result.total, 1);
    assert.equal(result.crit, 0);
    assert.equal(result.low, 0);
    assert.equal(result.med, 0);
    assert.equal(result.undetermined, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a medium unpatched_gem advisory into the med bucket', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bundlerAuditCounts-'));
  try {
    const f = join(dir, 'med.json');
    const data = {
      results: [{
        type: 'unpatched_gem',
        advisory: { id: 'GHSA-3', criticality: 'medium', title: 'Med issue' },
        gem: { name: 'gem3', version: '3.0.0' }
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _bundlerAuditCounts(dir, 'med.json');
    assert.equal(result.med, 1);
    assert.equal(result.total, 1);
    assert.equal(result.crit, 0);
    assert.equal(result.high, 0);
    assert.equal(result.low, 0);
    assert.equal(result.undetermined, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts a low unpatched_gem advisory into the low bucket', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bundlerAuditCounts-'));
  try {
    const f = join(dir, 'low.json');
    const data = {
      results: [{
        type: 'unpatched_gem',
        advisory: { id: 'GHSA-4', criticality: 'low', title: 'Low issue' },
        gem: { name: 'gem4', version: '4.0.0' }
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _bundlerAuditCounts(dir, 'low.json');
    assert.equal(result.low, 1);
    assert.equal(result.total, 1);
    assert.equal(result.crit, 0);
    assert.equal(result.high, 0);
    assert.equal(result.med, 0);
    assert.equal(result.undetermined, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('counts an advisory with null criticality into undetermined', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bundlerAuditCounts-'));
  try {
    const f = join(dir, 'null.json');
    const data = {
      results: [{
        type: 'unpatched_gem',
        advisory: { id: 'GHSA-5', criticality: null, title: 'Null issue' },
        gem: { name: 'gem5', version: '5.0.0' }
      }]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _bundlerAuditCounts(dir, 'null.json');
    assert.equal(result.undetermined, 1);
    assert.equal(result.total, 1);
    assert.equal(result.crit, 0);
    assert.equal(result.high, 0);
    assert.equal(result.med, 0);
    assert.equal(result.low, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('skips non-unpatched_gem result types entirely', () => {
  const dir = mkdtempSync(join(tmpdir(), '_bundlerAuditCounts-'));
  try {
    const f = join(dir, 'skip.json');
    const data = {
      results: [
        { type: 'insecure_source', advisory: { id: 'X', criticality: 'critical' }, gem: { name: 'g', version: '1' } },
        { type: 'unpatched_ruby', advisory: { id: 'Y', criticality: 'high' }, gem: { name: 'g', version: '2' } }
      ]
    };
    writeFileSync(f, JSON.stringify(data));
    const result = _bundlerAuditCounts(dir, 'skip.json');
    assert.equal(result.total, 0);
    assert.equal(result.crit, 0);
    assert.equal(result.high, 0);
    assert.equal(result.med, 0);
    assert.equal(result.low, 0);
    assert.equal(result.undetermined, undefined);
    assert.equal(result.ran, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

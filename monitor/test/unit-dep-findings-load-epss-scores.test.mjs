// Reads the EPSS score map from a JSON file (monitor/dep-findings.mjs loadEpssScores).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEpssScores, enrichKevEpss } from '../dep-findings.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withFile(text, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'loadEpssScores-'));
  try {
    const path = join(dir, 'epss.json');
    if (text !== undefined) writeFileSync(path, text);
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('returns the score map from a JSON object', () => {
  withFile('{"CVE-2024-1": 0.42}', (path) => assert.deepEqual(loadEpssScores(path), { 'CVE-2024-1': 0.42 }));
});

test('returns an empty map when the file is missing or not JSON', () => {
  withFile(undefined, (path) => assert.deepEqual(loadEpssScores(path), {}));
  withFile('{not json', (path) => assert.deepEqual(loadEpssScores(path), {}));
});

test('returns an empty map for JSON that is not an object, so enrichment still runs', () => {
  for (const text of ['null', '0.5', '"CVE-2024-1"', 'true', '["CVE-2024-1"]']) {
    withFile(text, (path) => {
      const scores = loadEpssScores(path);
      assert.deepEqual(scores, {}, text);
      const [finding] = enrichKevEpss([{ id: 'CVE-2024-1' }], { usable: false, set: new Set() }, scores);
      assert.equal(finding.epss, null, text);
    });
  }
});

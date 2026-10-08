// Tests for the R2 baseline (monitor/minify-baseline.mjs) and its ingestArea grandfather hook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placeKeyFor, placeKeysFromRollup, applyCapture, loadBaseline, loadBaselinePlaceKeys } from '../minify-baseline.mjs';
import { ingestArea } from '../issue-ingest.mjs';

const AT = '2026-08-11T00:00:00.000Z';

function rollupWith(minifiedRows) {
  return {
    generated: AT, sliceId: 'slice-1',
    scanners: { minifiedCode: { ran: true, total: minifiedRows.length } },
    scannerFindings: { minifiedCode: minifiedRows },
    repos: [],
  };
}

test('placeKeysFromRollup extracts line-free keys per repo', () => {
  const r = rollupWith([
    { repo: 'app', rule: 'minified-source', file: 'a.min.js', sev: 'med' },
    { repo: 'app', rule: 'bidi-homoglyph', file: 'b.js', sev: 'high' },
    { repo: 'lib', rule: 'minified-source', file: 'c.min.js', sev: 'med' },
  ]);
  const byRepo = placeKeysFromRollup(r);
  assert.deepEqual(byRepo.app, ['sc:app|minifiedCode|bidi-homoglyph|b.js', 'sc:app|minifiedCode|minified-source|a.min.js']);
  assert.deepEqual(byRepo.lib, ['sc:lib|minifiedCode|minified-source|c.min.js']);
});

test('capture is one-shot per repo; refresh is allowed and journaled', () => {
  let doc = { version: 1, repos: {}, journal: [] };
  const keys = [placeKeyFor('app', 'minified-source', 'a.min.js')];
  const r1 = applyCapture(doc, { repo: 'app', placeKeys: keys, at: AT, sliceId: 'slice-1', who: 'op' });
  doc = r1.doc;
  assert.equal(r1.action, 'capture');
  assert.equal(doc.repos.app.placeKeys.length, 1);
  assert.equal(doc.journal.length, 1);

  // second capture WITHOUT refresh → refused
  assert.throws(() => applyCapture(doc, { repo: 'app', placeKeys: keys, at: AT }), /already baselined/);

  // refresh → allowed, second journal entry, action 'refresh'
  const r2 = applyCapture(doc, { repo: 'app', placeKeys: [...keys, placeKeyFor('app', 'bidi-homoglyph', 'b.js')], at: AT, who: 'op', refresh: true });
  assert.equal(r2.action, 'refresh');
  assert.equal(r2.doc.repos.app.placeKeys.length, 2);
  assert.equal(r2.doc.journal.length, 2);
  assert.equal(r2.doc.journal[1].action, 'refresh');
});

test('capture is deterministic: sorted keys + stable sliceHash', () => {
  const a = applyCapture({ version: 1, repos: {}, journal: [] }, { repo: 'app', placeKeys: ['sc:app|minifiedCode|z|z.js', 'sc:app|minifiedCode|a|a.js'], at: AT });
  const b = applyCapture({ version: 1, repos: {}, journal: [] }, { repo: 'app', placeKeys: ['sc:app|minifiedCode|a|a.js', 'sc:app|minifiedCode|z|z.js'], at: AT });
  assert.deepEqual(a.doc.repos.app.placeKeys, b.doc.repos.app.placeKeys);
  assert.equal(a.doc.repos.app.sliceHash, b.doc.repos.app.sliceHash);
});

test('loadBaseline: ENOENT → empty; corrupt → _unreadable (grandfathers nothing)', () => {
  const d = mkdtempSync(join(tmpdir(), 'mb-'));
  assert.deepEqual(loadBaseline(join(d, 'nope.json')).repos, {});
  writeFileSync(join(d, 'bad.json'), '{ not json');
  assert.equal(loadBaseline(join(d, 'bad.json'))._unreadable, true);
  rmSync(d, { recursive: true, force: true });
});

test('ingestArea grandfathers baselined rows; files only NEW place keys', () => {
  const rows = [
    { repo: 'app', rule: 'minified-source', file: 'a.min.js', sev: 'high', line: 1 },   // baselined
    { repo: 'app', rule: 'exec-decode-pair', file: 'new.js', sev: 'high', line: 9 },     // NEW → files
  ];
  const baseline = new Set([placeKeyFor('app', 'minified-source', 'a.min.js')]);
  const doc = { issues: {}, byKey: {}, seq: 0, lastIngest: {} };
  const summary = ingestArea(doc, {
    areaSlug: 'app', rollup: rollupWith(rows), now: AT, minSev: 'high',
    baselinePlaceKeys: baseline, dryRun: true,
  });
  assert.equal(summary.baselinedRows, 1, 'the pre-existing row must be grandfathered');
  // only the NEW row files; and it is the exec-decode-pair one, not the baselined one
  assert.equal(summary.created.length, 1);
  assert.ok(summary.created[0].includes('new.js'), `expected the new row to file, got ${summary.created[0]}`);
});

test('ingestArea with no baseline (null) is unchanged — both rows file', () => {
  const rows = [
    { repo: 'app', rule: 'minified-source', file: 'a.min.js', sev: 'high', line: 1 },
    { repo: 'app', rule: 'exec-decode-pair', file: 'new.js', sev: 'high', line: 9 },
  ];
  const doc = { issues: {}, byKey: {}, seq: 0, lastIngest: {} };
  const summary = ingestArea(doc, { areaSlug: 'app', rollup: rollupWith(rows), now: AT, minSev: 'high', dryRun: true });
  assert.equal(summary.baselinedRows, undefined);
  assert.equal(summary.created.length, 2, 'without a baseline every row files (no behaviour change)');
});

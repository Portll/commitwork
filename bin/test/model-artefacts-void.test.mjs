// model-artefacts runs on every repository and stays a void where there is no model surface. That
// is deliberate — the surface is decided by content (a yaml carrying data_files, a README front
// matter, a .py calling from_pretrained), so an extension gate would either miss the Hugging Face
// dataset-card case the lane exists for or apply everywhere. What was missing is the WORDS: 17 repos
// in one sweep read "scanned 0 files — a walk that examined nothing is not a clean result", which
// sounds like a broken lane rather than an absent surface. Both readers of that report must agree.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanTree } from '../model-artefacts.mjs';
import { parseReport, classifyReport } from '../commitwork.mjs';
import { _modelArtefactsCounts } from '../../monitor/extractors.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-model-void-'));
let n = 0;
const tree = (files) => {
  const d = join(T, `t${n++}`);
  mkdirSync(d, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(d, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return d;
};

const reportDir = (doc) => {
  const d = join(T, `r${n++}`);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'model-artefacts.json'), JSON.stringify(doc));
  writeFileSync(join(d, 'model-artefacts.json.exit'), '0\n');
  return d;
};
const CHECK = { id: 'model-artefacts', report: { file: 'model-artefacts.json', format: 'rule-counts' } };

describe('a tree with no model surface', () => {
  test('the scanner says why its walk examined nothing', () => {
    const r = scanTree(tree({ 'README.md': '# a repo\n', 'src/index.mjs': 'export const x = 1;\n' }));
    assert.equal(r.summary.filesScanned, 0);
    assert.match(r.summary.voidReason, /no model surface/);
    assert.match(r.summary.voidReason, /decided by content/, 'the reason has to say why the lane ran here at all');
  });

  test('a partial read is NOT called an absent surface', () => {
    const r = scanTree(tree({ 'model.pkl': '\u0080\u0002' }));
    assert.equal(r.summary.voidReason, undefined, 'files were examined; whatever this is, it is not "no surface"');
  });

  test('the runner reports the void with the scanner\'s own words, not a generic one', () => {
    const r = scanTree(tree({ 'README.md': '# a repo\n' }));
    const d = reportDir(r);
    const { sev, summary } = classifyReport(CHECK, d, d);
    assert.equal(sev, 'noscan', 'an absent surface stays a void — a zero here is not a clean result');
    assert.match(summary, /no model surface/);
  });

  test('a report with no voidReason keeps the generic wording rather than inventing one', () => {
    const d = reportDir({ tool: 'model-artefacts', summary: { findings: 0, byRule: {}, filesScanned: 0 }, findings: [] });
    assert.match(parseReport('rule-counts', join(d, 'model-artefacts.json')).summary, /a walk that examined nothing/);
  });

  test('the rollup extractor reads the same report as a void, so the two readers agree', () => {
    const r = scanTree(tree({ 'README.md': '# a repo\n' }));
    const d = reportDir(r);
    const counts = _modelArtefactsCounts(d, 'model-artefacts.json');
    assert.equal(counts.nosrc, true);
    assert.equal(counts.total, 0);
  });
});

describe('the gate stays off, deliberately', () => {
  test('the lane declares no applicability gate, and its formatNotes say why', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../manifests/security-baseline.json', import.meta.url), 'utf8'));
    const check = manifest.checks.find((c) => c.id === 'model-artefacts');
    assert.equal(check.appliesIfSourceExt, undefined, 'an extension list would skip the dataset-card case this lane exists for');
    assert.equal(check.appliesIfExists, undefined);
    assert.match(check.formatNotes, /NOT GATED, deliberately/);
  });
});

// Computes the STPA closure-point classification rows and summary for one sweep run (monitor/stpa-sweep.mjs runOnce).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOnce } from '../stpa-sweep.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns all unclassified rows when no dispatch, no policy gate, no apply check, and no envelope', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runOnce-'));
  try {
    const sp = join(dir, 'serve.mjs');
    const pp = join(dir, 'policy.mjs');
    const ap = join(dir, 'apply.mjs');
    const rp = join(dir, 'remed.mjs');
    const wp = join(dir, 'witness.json');
    writeFileSync(sp, 'const x = 1;\n');
    writeFileSync(pp, 'const y = 2;\n');
    writeFileSync(ap, 'const z = 3;\n');
    writeFileSync(rp, 'const w = 4;\n');
    const result = runOnce({ servePath: sp, policyPath: pp, applyPath: ap, remedPath: rp, witness: wp });
    assert.equal(result.summary.total, 6);
    assert.equal(result.summary.flagged, 0);
    assert.equal(result.summary.unclassified, 5);
    assert.equal(result.summary.openFindings, 1);
    const uca1 = result.rows.find(r => r.uca === "UCA1'");
    assert.equal(uca1.verdict, 'unclassified');
    assert.equal(uca1.subject, 'trigger() dispatch');
    const uca2a = result.rows.find(r => r.uca === "UCA2'" && r.subject.includes('mode escalation'));
    assert.equal(uca2a.verdict, 'unclassified');
    const uca2b = result.rows.find(r => r.uca === "UCA2'" && r.subject.includes('autoMerge'));
    assert.equal(uca2b.verdict, 'unclassified');
    const uca3 = result.rows.find(r => r.uca === "UCA3'/UCA5'");
    assert.equal(uca3.verdict, 'unclassified');
    const uca7 = result.rows.find(r => r.uca === "UCA7'");
    assert.equal(uca7.verdict, 'unclassified');
    const adv = result.rows.find(r => r.uca === '++ADVERSARIAL');
    assert.equal(adv.verdict, 'open-finding');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies trigger kinds as allowlist when resolver exists and no raw opts reference', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runOnce-'));
  try {
    const sp = join(dir, 'serve.mjs');
    const pp = join(dir, 'policy.mjs');
    const ap = join(dir, 'apply.mjs');
    const rp = join(dir, 'remed.mjs');
    const wp = join(dir, 'witness.json');
    const serveSrc = "const proj = triggerProject(opts);\nif (kind === 'sweep') { run(proj); } else if (kind === 'bola') { run(proj); }\n";
    writeFileSync(sp, serveSrc);
    writeFileSync(pp, 'const y = 2;\n');
    writeFileSync(ap, 'const z = 3;\n');
    writeFileSync(rp, 'const w = 4;\n');
    const result = runOnce({ servePath: sp, policyPath: pp, applyPath: ap, remedPath: rp, witness: wp });
    const uca1rows = result.rows.filter(r => r.uca === "UCA1'");
    assert.equal(uca1rows.length, 2);
    assert.equal(uca1rows[0].subject, 'trigger kind "sweep"');
    assert.equal(uca1rows[0].verdict, 'classified-safe');
    assert.equal(uca1rows[1].subject, 'trigger kind "bola"');
    assert.equal(uca1rows[1].verdict, 'classified-safe');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies trigger kind as unclassified when raw opts reference is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runOnce-'));
  try {
    const sp = join(dir, 'serve.mjs');
    const pp = join(dir, 'policy.mjs');
    const ap = join(dir, 'apply.mjs');
    const rp = join(dir, 'remed.mjs');
    const wp = join(dir, 'witness.json');
    const serveSrc = "const proj = triggerProject(opts);\nif (kind === 'sweep') { run(opts.secret); }\n";
    writeFileSync(sp, serveSrc);
    writeFileSync(pp, 'const y = 2;\n');
    writeFileSync(ap, 'const z = 3;\n');
    writeFileSync(rp, 'const w = 4;\n');
    const result = runOnce({ servePath: sp, policyPath: pp, applyPath: ap, remedPath: rp, witness: wp });
    const uca1rows = result.rows.filter(r => r.uca === "UCA1'");
    assert.equal(uca1rows.length, 1);
    assert.equal(uca1rows[0].subject, 'trigger kind "sweep"');
    assert.equal(uca1rows[0].verdict, 'unclassified');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies policy gate as safe when settable modes and 403 gate are present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runOnce-'));
  try {
    const sp = join(dir, 'serve.mjs');
    const pp = join(dir, 'policy.mjs');
    const ap = join(dir, 'apply.mjs');
    const rp = join(dir, 'remed.mjs');
    const wp = join(dir, 'witness.json');
    writeFileSync(sp, 'const x = 1;\n');
    const policySrc = "const API_SETTABLE_MODES = new Set(['review', 'auto']);\nif (doc.mode !== undefined) { return send(403); }\n";
    writeFileSync(pp, policySrc);
    writeFileSync(ap, 'const z = 3;\n');
    writeFileSync(rp, 'const w = 4;\n');
    const result = runOnce({ servePath: sp, policyPath: pp, applyPath: ap, remedPath: rp, witness: wp });
    const uca2a = result.rows.find(r => r.uca === "UCA2'" && r.subject.includes('mode escalation'));
    assert.equal(uca2a.verdict, 'classified-safe');
    const uca2b = result.rows.find(r => r.uca === "UCA2'" && r.subject.includes('autoMerge'));
    assert.equal(uca2b.verdict, 'flagged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies apply check as safe when git apply --check is present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runOnce-'));
  try {
    const sp = join(dir, 'serve.mjs');
    const pp = join(dir, 'policy.mjs');
    const ap = join(dir, 'apply.mjs');
    const rp = join(dir, 'remed.mjs');
    const wp = join(dir, 'witness.json');
    writeFileSync(sp, 'const x = 1;\n');
    writeFileSync(pp, 'const y = 2;\n');
    const applySrc = "git(['apply', '--check', diff]);\n";
    writeFileSync(ap, applySrc);
    writeFileSync(rp, 'const w = 4;\n');
    const result = runOnce({ servePath: sp, policyPath: pp, applyPath: ap, remedPath: rp, witness: wp });
    const uca3 = result.rows.find(r => r.uca === "UCA3'/UCA5'");
    assert.equal(uca3.verdict, 'classified-safe');
    assert.equal(uca3.detail, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies adversarial as open-finding when envelope paths are missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runOnce-'));
  try {
    const sp = join(dir, 'serve.mjs');
    const pp = join(dir, 'policy.mjs');
    const ap = join(dir, 'apply.mjs');
    const rp = join(dir, 'remed.mjs');
    const wp = join(dir, 'witness.json');
    writeFileSync(sp, 'const x = 1;\n');
    writeFileSync(pp, 'const y = 2;\n');
    writeFileSync(ap, 'const z = 3;\n');
    writeFileSync(rp, 'const w = 4;\n');
    const result = runOnce({ servePath: sp, policyPath: pp, applyPath: ap, remedPath: rp, witness: wp });
    const adv = result.rows.find(r => r.uca === '++ADVERSARIAL');
    assert.equal(adv.verdict, 'open-finding');
    assert.match(adv.detail, /no typed envelope/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies adversarial as classified-safe when envelope paths exist and witness is fresh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runOnce-'));
  try {
    const sp = join(dir, 'serve.mjs');
    const pp = join(dir, 'policy.mjs');
    const ap = join(dir, 'apply.mjs');
    const rp = join(dir, 'remed.mjs');
    const wp = join(dir, 'witness.json');
    writeFileSync(sp, 'const x = 1;\n');
    writeFileSync(pp, 'const y = 2;\n');
    const applySrc = "import { envelope } from '../../lib/prompt-envelope.mjs';\nfunction findingBlock() { return envelope(); }\n";
    writeFileSync(ap, applySrc);
    const remedSrc = "import { envelope } from '../../lib/prompt-envelope.mjs';\nasync function runLocalModel() { return envelope(artifactText); }\n";
    writeFileSync(rp, remedSrc);
    const now = new Date();
    const at = new Date(now.getTime() - 1000).toISOString();
    writeFileSync(wp, JSON.stringify({ pass: true, at }));
    const result = runOnce({ servePath: sp, policyPath: pp, applyPath: ap, remedPath: rp, witness: wp });
    const adv = result.rows.find(r => r.uca === '++ADVERSARIAL');
    assert.equal(adv.verdict, 'classified-safe');
    assert.match(adv.detail, /live corpus replay passed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies cross-check as safe when all three closure points are readable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'runOnce-'));
  try {
    const sp = join(dir, 'serve.mjs');
    const pp = join(dir, 'policy.mjs');
    const ap = join(dir, 'apply.mjs');
    const rp = join(dir, 'remed.mjs');
    const wp = join(dir, 'witness.json');
    const serveSrc = "const proj = triggerProject(opts);\nif (kind === 'sweep') { run(proj); }\n";
    writeFileSync(sp, serveSrc);
    const policySrc = "const API_SETTABLE_MODES = new Set(['review']);\nif (doc.mode !== undefined) { return send(403); }\n";
    writeFileSync(pp, policySrc);
    writeFileSync(ap, 'const z = 3;\n');
    writeFileSync(rp, 'const w = 4;\n');
    const result = runOnce({ servePath: sp, policyPath: pp, applyPath: ap, remedPath: rp, witness: wp });
    const uca7 = result.rows.find(r => r.uca === "UCA7'");
    assert.equal(uca7.verdict, 'classified-safe');
    assert.equal(uca7.detail, 'all three closure points were readable this run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

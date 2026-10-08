// The ratchet's `drifted` metric must come from the structured document, so neither the prose
// wording nor the exit code can decide it. The gate is a Stop hook — importing it RUNS a
// measurement — so it is driven as a subprocess through its own env seams.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Run the gate with --show (prints baseline vs now, changes nothing) under a scratch baseline. */
function show(anchorDoc, { raw } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-measure-'));
  try {
    const anchors = join(dir, 'anchors.json');
    writeFileSync(anchors, raw !== undefined ? raw : `${JSON.stringify(anchorDoc, null, 2)}\n`);
    const baseline = join(dir, 'baseline.json');
    // an absurd baseline so the printed "now" column cannot be confused with the floor
    writeFileSync(baseline, `${JSON.stringify({ conflicts: 0, unreviewed: 0, drifted: 9999, at: '2026-08-01T00:00:00.000Z' })}\n`);
    const verdicts = join(dir, 'verdicts');
    const hook = join(dir, 'hook');
    mkdirSync(verdicts, { recursive: true });
    mkdirSync(hook, { recursive: true });
    let out = '';
    try {
      out = execFileSync(process.execPath, [join(REPO, 'bin', 'gate-ratchet.mjs'), '--show'], {
        cwd: REPO, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CW_ANCHOR_STALENESS_JSON: anchors,
          CW_RATCHET_BASELINE: baseline,
          CW_VERDICT_DIR: verdicts,
          CW_HOOK_STATE: hook,
        },
      });
    } catch (e) { out = `${String(e.stdout || '')}\n${String(e.stderr || '')}`; }
    // "  9999 →   NNN  open findings whose anchor drifted"
    const m = out.match(/9999\s*→\s*(\S+)\s+open findings whose anchor drifted/);
    return { out, drifted: m ? m[1] : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('drifted comes from the document`s own count, not from a sentence', () => {
  const r = show({ driftedOpen: 3, results: [] });
  assert.equal(r.drifted, '3', `expected 3 from driftedOpen; got ${r.drifted}\n${r.out}`);
});

test('drifted 0 is a real 0 when the document says so', () => {
  const r = show({ driftedOpen: 0, results: [] });
  assert.equal(r.drifted, '0');
});

// A document that parses but carries no count is a schema that moved — it must read UNKNOWN, never 0.
test('a document with NO driftedOpen key is UNKNOWN, never 0', () => {
  const r = show({ results: [] });
  assert.equal(r.drifted, '?', `a missing count must render unknown, got ${r.drifted}\n${r.out}`);
});

test('a non-numeric driftedOpen is UNKNOWN, never coerced', () => {
  const r = show({ driftedOpen: 'lots', results: [] });
  assert.equal(r.drifted, '?');
});

test('unparseable bytes are UNKNOWN — a corrupt report is not an empty one', () => {
  const r = show(null, { raw: '{"driftedOpen": 5, TRUNCATED' });
  assert.equal(r.drifted, '?');
});

// A fixture where `results` and `driftedOpen` disagree proves the metric is not re-derived from
// `results` behind the scenes.
test('the count is the producer`s, not re-derived from results', () => {
  const r = show({
    driftedOpen: 7,
    results: [{ disposition: 'open', state: 'anchor-changed', file: 'a.mjs' }],
  });
  assert.equal(r.drifted, '7', 'the metric must take the producer’s count, not count the array itself');
});

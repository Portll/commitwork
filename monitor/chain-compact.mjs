#!/usr/bin/env node
// commitwork monitor — chain.jsonl SIZE SWEEPER. Checkpoint rotation, never truncation.
//
// An append-only log needs a size answer, and for a tamper-evident log the answer must not be the
// tamper vector: deleting old lines is exactly the "drop a recorded state" edit the chain exists
// to name. So the sweeper ROTATES: the oversized log is renamed whole into an archive segment
// beside it, and the new chain.jsonl opens with a `checkpoint` event whose prev IS the archived
// tip — verification runs end-to-end through the rotation (verifyChain re-checks the archived
// segment's tip against the checkpoint whenever the archive is still on disk), and an anchor is
// written after each rotation so the sidecar sees the new tip immediately.
//
// TWO REFUSALS ARE THE POINT:
//   · a chain that does not currently verify is NEVER rotated — rotating it would launder the
//     evidence into an archive nobody re-reads; the broken state stays in place, named, for the
//     operator. (Same posture as the gate that refuses to build on a torn tail.)
//   · with no configured maximum the sweeper does NOTHING, loudly. Setting retention.chainMaxBytes
//     in monitor/projects.json (shown on the /config panel beside the other retention keys) is the
//     operator's act; a size policy this tool invented would be an instruction, not a pin.
//
// usage:  node monitor/chain-compact.mjs [--apply] [--area <out>] [--max-bytes N]
//         dry by default (reports what WOULD rotate); --apply takes the root-wide reports lock
//         (a rotation racing a rollup's append would lose the append). CW_NOW pins the clock;
//         CW_CHAIN_MAX_BYTES overrides config; --max-bytes overrides both.

import { nowISO as clockISO } from '../lib/clock.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChain, verifyChain, appendChainEvent, appendAnchor, anchorableOut, CHAIN_FILE } from './history-chain.mjs';
import { reportsRootDir } from './area.mjs';
import { takeReportsLock, describeAge } from './lockfile.mjs';
import { registryPathFor } from './store-paths.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Rotate ONE area's chain if it exceeds maxBytes. Pure-ish core so tests exercise the decision
 * table without a subprocess. Returns { rotated, reason, archive?, sizeBytes, length? } — every
 * path answers, and a refusal carries its why.
 */
export function compactChain(histDir, { maxBytes, nowISO, area = null, outPath = null, by = null, reg = null } = {}) {
  const p = path.join(histDir, CHAIN_FILE);
  let size;
  try { size = fs.statSync(p).size; }
  catch (e) {
    return e.code === 'ENOENT'
      ? { rotated: false, reason: 'no chain log — nothing to sweep', sizeBytes: 0 }
      : { rotated: false, reason: `${e.code} reading ${p}`, sizeBytes: null };
  }
  if (!(Number.isFinite(maxBytes) && maxBytes > 0)) {
    return { rotated: false, reason: 'no chainMaxBytes configured — set retention.chainMaxBytes in monitor/projects.json (or pass --max-bytes); an unconfigured sweeper sweeps nothing', sizeBytes: size };
  }
  if (size <= maxBytes) return { rotated: false, reason: `under the maximum (${size}B ≤ ${maxBytes}B)`, sizeBytes: size };

  // read the index so the verify cross-checks (unrecorded/drifted) run with their real inputs
  let idx = null;
  try { idx = JSON.parse(fs.readFileSync(path.join(histDir, 'index.json'), 'utf8')); } catch { /* verified below without cross-checks */ }
  const v = verifyChain(histDir, Array.isArray(idx) ? idx : []);
  if (!v.verified || v.tailTorn || v.error) {
    return { rotated: false, sizeBytes: size,
      reason: `REFUSED — the chain does not verify (${v.error || (v.tailTorn ? 'torn tail' : v.brokenAt ? `broken at line ${v.brokenAt.line}` : v.drifted.length ? `${v.drifted.length} drifted index row(s)` : 'unverified')}); rotating it would launder the evidence into an archive. Fix or explain the break first.` };
  }
  const { events } = readChain(histDir);
  const tip = events[events.length - 1].chain;
  const stamp = (nowISO || new Date().toISOString()).replace(/[-:TZ.]/g, '').slice(0, 14);
  const archive = `chain.${stamp}.jsonl`;
  if (fs.existsSync(path.join(histDir, archive))) {
    return { rotated: false, sizeBytes: size, reason: `archive ${archive} already exists — refusing to overwrite a prior rotation` };
  }
  fs.renameSync(p, path.join(histDir, archive)); // atomic same-dir: the log is never half-moved
  appendChainEvent(histDir, {
    at: nowISO, op: 'checkpoint', source: archive, prevTip: tip,
    by: by || process.env.CW_CHAIN_BY || 'monitor/chain-compact.mjs',
    note: `rotated ${events.length} event(s), ${size}B → ${archive}`,
  });
  let anchored = false, anchorWhy = null;
  if (area && reg) {
    const a = anchorableOut(outPath || area, reg); // anchorableOut judges the OUT path (rollup's own convention)
    if (a.anchorable) { try { appendAnchor(histDir, area, nowISO); anchored = true; } catch (e) { anchorWhy = e.message; } }
    else anchorWhy = a.why;
  }
  return { rotated: true, archive, sizeBytes: size, length: events.length, anchored, anchorWhy, reason: null };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const isMain = isMainModule(import.meta.url);
if (isMain) {
  const APPLY = process.argv.includes('--apply');
  const argOf = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : null; };
  const onlyArea = argOf('--area');
  const reg = JSON.parse(fs.readFileSync(registryPathFor(path.join(HERE, '..')), 'utf8'));
  const ROOT = reportsRootDir(reg);
  const maxBytes = +(argOf('--max-bytes') || process.env.CW_CHAIN_MAX_BYTES || (reg.retention || {}).chainMaxBytes || 0) || null;
  const nowISO = clockISO();

  if (APPLY) {
    const held = takeReportsLock(ROOT, { label: 'chain-compact' });
    if (!held.ok) {
      console.error(`[chain-compact] another reports-root writer is running (${held.path}, ${describeAge(held.heldFor)}) — skipping rather than racing it.`);
      process.exit(0);
    }
  }
  let dirs = [];
  try {
    dirs = fs.readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('sweep-'))
      .map((e) => e.name)
      .filter((n) => !onlyArea || n === onlyArea)
      .filter((n) => fs.existsSync(path.join(ROOT, n, 'history', CHAIN_FILE)));
  } catch (e) { console.error(`[chain-compact] cannot read ${ROOT}: ${e.code}`); process.exit(1); }

  let rotated = 0;
  for (const name of dirs) {
    const histDir = path.join(ROOT, name, 'history');
    if (!APPLY) {
      let size = 0; try { size = fs.statSync(path.join(histDir, CHAIN_FILE)).size; } catch { /* raced away */ }
      const would = Number.isFinite(maxBytes) && maxBytes > 0 && size > maxBytes;
      console.log(`[chain-compact] ${name} — ${size}B${would ? ` — WOULD rotate (> ${maxBytes}B); run with --apply` : maxBytes ? ' — under max' : ' — no chainMaxBytes configured'}`);
      continue;
    }
    const r = compactChain(histDir, { maxBytes, nowISO, area: name, outPath: path.join(ROOT, name), reg });
    if (r.rotated) { rotated++; console.log(`[chain-compact] ${name} — rotated ${r.length} event(s), ${r.sizeBytes}B → ${r.archive}${r.anchored ? ' · anchored' : r.anchorWhy ? ` · not anchored (${r.anchorWhy})` : ''}`); }
    else console.log(`[chain-compact] ${name} — ${r.reason}`);
  }
  if (APPLY) console.log(`[chain-compact] ${rotated} chain(s) rotated of ${dirs.length} inspected`);
}

// lib/lexical-ratchet.mjs — the shared shape of a LEXICAL HALF-LEVER: a detector over tracked
// files, a baseline of the offenders it found when it was armed, and two assertions that only
// together make it a gate — no NEW offender may appear, and no baseline entry may go stale.
//
// Why a ratchet and not a refusal: each detector here is lexical, so it decides a FORM of a
// defect class, never the class. A refusal over the whole tree would fail on the day it is armed
// and be disabled by the evening; a ratchet holds the line where it stands and only ever tightens.
// Why the baseline must stay exact: an allowlist its only producer cannot fail is a comment
// (measured on this repo; see CLAUDE.md on guards needing a second witness). A baseline entry
// that no longer offends is refused too, so the list shrinks as fixes land instead of fossilising.
// Why a positive control: a detector that matches nothing is indistinguishable from a clean tree
// (taxonomy C26, M23), so every consumer plants a known offender through the same detector.
//
// Population is `git ls-files` (the release ships the tree as committed), read from the working
// tree (a lexical rule is about the file as it will be committed). Env, read at call time:
// CW_RATCHET_REPO overrides the repository root for fixture runs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const repoRoot = () => process.env.CW_RATCHET_REPO || resolve(HERE, '..', '..');

/** Tracked files matching any of the pathspecs, relative to the repo root. */
export function trackedFiles(pathspecs, root = repoRoot()) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '--', ...pathspecs], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

/**
 * Run `detect(text, file)` over every tracked file in `pathspecs`; it returns an array of offence
 * keys (strings) for that file, empty when clean. Returns { offenders: Set<string>, scanned }.
 */
export function scan({ pathspecs, detect, exclude = () => false, root = repoRoot() }) {
  const offenders = new Set();
  let scanned = 0;
  for (const f of trackedFiles(pathspecs, root)) {
    if (exclude(f)) continue;
    let text;
    try { text = readFileSync(join(root, f), 'utf8'); } catch (e) {
      // Never a clean read: a file git tracks and this cannot read is a finding in itself.
      offenders.add(`${f}: unreadable (${e.code || e.message})`);
      continue;
    }
    scanned++;
    for (const key of detect(text, f)) offenders.add(key);
  }
  return { offenders, scanned };
}

/**
 * The ratchet judgement. `baseline` is the offender set frozen when the gate was armed.
 * Returns { added, stale, ok } — added: offences not in the baseline (the gate fails);
 * stale: baseline entries that no longer offend (the gate fails until the baseline is pruned).
 */
export function ratchet(offenders, baseline) {
  const base = new Set(baseline);
  const added = [...offenders].filter((k) => !base.has(k)).sort();
  const stale = [...base].filter((k) => !offenders.has(k)).sort();
  return { added, stale, ok: added.length === 0 && stale.length === 0 };
}

/** One message a reader can act on, or '' when the ratchet holds. */
export function explain(name, { added, stale }, { fixHint }) {
  const lines = [];
  if (added.length) lines.push(`${name}: ${added.length} NEW offender(s) — ${fixHint}\n  ${added.join('\n  ')}`);
  if (stale.length) lines.push(`${name}: ${stale.length} baseline entr${stale.length === 1 ? 'y' : 'ies'} no longer offend — remove them from the baseline so the ratchet only tightens\n  ${stale.join('\n  ')}`);
  return lines.join('\n');
}

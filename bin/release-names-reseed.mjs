#!/usr/bin/env node
// release-names-reseed.mjs — lower the release-names HEAD floor as cleanups land.
//
// MONOTONE BY CONSTRUCTION: it removes baseline entries that are clean at HEAD and can add nothing.
// A reseed that wrote whatever the scan currently sees would let the floor be re-derived to accept a
// NEW offender, which is a gate whose metric equals its own remediation — it would certify itself.
// The fixture's own comment states the same rule in prose; this makes it a property of the tool.
//
// Why a tool at all: the floor cannot be maintained by hand at fleet cadence. Measured 2026-09-02 —
// HEAD moved between two consecutive 22-second runs of the gate, so the entries it named as
// removable were already stale by the time they could be edited out. A ratchet nobody can service
// is a ratchet that stays red and then gets ignored.
//
// The scan is imported from bin/lib/release-names-head-scan.mjs, NOT from the gate: importing a
// file that calls test() registers its tests, so importing the gate would run it as a side effect.
//
// Usage: node bin/release-names-reseed.mjs [--write]     (default is a dry run)

import { readFileSync, writeFileSync } from 'node:fs';
import { currentOffenders, loadBaseline, baselinePath } from './lib/release-names-head-scan.mjs';

const write = process.argv.includes('--write');

const now = currentOffenders();
const base = loadBaseline();
const nowPaths = new Set(now.paths);
const nowContent = new Set(now.content);

const dropPaths = base.paths.filter((p) => !nowPaths.has(p));
const dropContent = base.content.filter((p) => !nowContent.has(p));

// The direction that must never happen silently. An offender at HEAD that the baseline does not
// carry is a REGRESSION, and this tool refuses rather than absorbing it — that is the gate's job to
// report and a human's to fix.
const newPaths = now.paths.filter((p) => !base.paths.includes(p));
const newContent = now.content.filter((p) => !base.content.includes(p));

if (newPaths.length || newContent.length) {
  console.error('REFUSING: these are offenders at HEAD that the baseline does not carry.');
  for (const p of newPaths) console.error(`  path::${p}`);
  for (const p of newContent) console.error(`  content::${p}`);
  console.error('A reseed may only lower the floor. Fix the offender, or land its rename.');
  process.exit(2);
}

if (!dropPaths.length && !dropContent.length) {
  console.log('floor is already at reality — nothing to remove');
  process.exit(0);
}

console.log(`clean at HEAD and removable: ${dropPaths.length} path(s), ${dropContent.length} content file(s)`);
for (const p of dropPaths) console.log(`  - paths::${p}`);
for (const p of dropContent) console.log(`  - content::${p}`);

if (!write) {
  console.log('\ndry run — pass --write to apply');
  process.exit(0);
}

// RAW-TEXT EDIT, NEVER A JSON ROUND TRIP. The fixture \u-escapes the identities it floors so that it
// does not itself publish them, and JSON.parse/JSON.stringify resolves those escapes into literals —
// the file would then trip the very gates it feeds. Its own comment says: do not tidy the escapes away.
const path = baselinePath();
const before = readFileSync(path, 'utf8');
const escapesBefore = (before.match(/\\u00[0-9a-f]{2}/g) || []).length;

// Keys are matched by their PARSED value, not by a literal. The identities are \u-escaped inside
// the KEYS, not merely in values — a key reads as `"bin/\u0073..."` rather than as the name — so a
// regex built from the parsed key string matches nothing, and a tool that treated "no match" as
// "already gone" would silently skip exactly the entries the escaping protects.
//
// This comment carries no example of the escaped name, and the omission is not fastidiousness: the
// first draft spelled one out to illustrate the point, which made this file an offender against the
// gate it services. The tool caught itself — the monotone check refused to lower a floor while a new
// offender stood, and exited rather than absorbing its own regression.
const removals = new Set([...dropPaths.map((p) => `paths:${p}`), ...dropContent.map((p) => `content:${p}`)]);
let section = null;
const kept = [];
let removed = 0;
let escapesRemovedWithEntries = 0;
for (const line of before.split('\n')) {
  const sec = line.match(/^\s*"(paths|content)":\s*\{/);
  if (sec) section = sec[1];
  const entry = line.match(/^\s*("(?:[^"\\]|\\.)*")\s*:\s*\d+,?\s*$/);
  if (entry && section) {
    let key;
    try { key = JSON.parse(entry[1]); } catch { key = null; }
    if (key !== null && removals.has(`${section}:${key}`)) {
      removed++;
      escapesRemovedWithEntries += (line.match(/\\u00[0-9a-f]{2}/g) || []).length;
      continue;
    }
  }
  kept.push(line);
}
if (removed !== removals.size) {
  console.error(`REFUSING: asked to remove ${removals.size} entr(ies) and matched ${removed}. Not editing a file it cannot read exactly.`);
  process.exit(3);
}
let out = kept.join('\n').replace(/,(\s*})/g, '$1');

// The invariant is NOT "the escape count never moves" — a removed entry whose own key carried an
// escaped identity takes that escape with it, legitimately. It is that no escape disappears for any
// OTHER reason, because that is how a literal identity gets into a file whose purpose is to name
// what must not be published without publishing it.
const escapesAfter = (out.match(/\\u00[0-9a-f]{2}/g) || []).length;
const escapesExpected = escapesBefore - escapesRemovedWithEntries;
if (escapesAfter !== escapesExpected) {
  console.error(`REFUSING: \\u escapes are ${escapesAfter}, expected ${escapesExpected} `
    + `(${escapesBefore} before, ${escapesRemovedWithEntries} carried out by removed entries). `
    + 'An escape lost for any other reason means the fixture now publishes a name it floors.');
  process.exit(4);
}
JSON.parse(out); // must still parse

writeFileSync(path, out);
console.log(`\nwrote ${path} — floor lowered by ${dropPaths.length + dropContent.length} entr(ies), ${escapesAfter} escapes preserved`);

// monitor/vintage.mjs — which commitwork produced each repo's rows, and how many runners a batch had.
//
// A sweep spawns bin/commitwork.mjs fresh per repo while the tree it lives in is committed to by
// many sessions (25 commits landed inside sweep-20260822153004). bin/commitwork.mjs writes
// toolchain.json per invocation: {sha, sourceDirtyHash, sourceDirty[]}. Same {sha, sourceDirtyHash}
// ⇒ same runner. This derives the batch-level fact from those receipts. It is a separate field from
// rollup.vintage.mixed, which is about lane TIMESTAMPS, not code.
//
// Receipts that predate the field count as `unrecorded` — never as a vintage of their own and
// never as agreement with the recorded ones.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read one repo's toolchain.json. ENOENT → null (legitimately absent); anything else → unreadable. */
export function readToolchain(repoDir) {
  try { return JSON.parse(readFileSync(join(repoDir, 'toolchain.json'), 'utf8')); }
  catch (e) {
    if (e && e.code === 'ENOENT') return null;
    return { sha: null, sourceDirtyHash: null, reason: `toolchain.json unreadable (${(e && e.code) || 'error'})` };
  }
}

/**
 * @param {Array<{name: string, toolchain: object|null}>} entries one per repo in the batch
 * @returns {{distinct:number, recorded:number, unrecorded:number, shas:Array, note:string, mixed:boolean}}
 */
export function codeVintage(entries) {
  const byKey = new Map(); let unrecorded = 0;
  for (const { name, toolchain: t } of entries) {
    if (!t || !t.sha) { unrecorded += 1; continue; }
    const key = `${t.sha}|${t.sourceDirtyHash || ''}`;
    const e = byKey.get(key) || { sha: t.sha, sourceDirtyHash: t.sourceDirtyHash || null, sourceDirty: (t.sourceDirty || []).length, repos: [] };
    e.repos.push(name); byKey.set(key, e);
  }
  const shas = [...byKey.values()].sort((a, b) => b.repos.length - a.repos.length);
  const distinct = shas.length;
  const tag = (s) => `${s.sha.slice(0, 7)}${s.sourceDirtyHash ? '+dirty' : ''}`;
  const note = distinct > 1
    ? `MIXED CODE VINTAGE — ${distinct} different commitwork runners produced these rows (${shas.map((s) => `${tag(s)}×${s.repos.length}`).join(', ')}). Compare repos only within one runner.`
    : distinct === 1
      ? `one runner (${tag(shas[0])}${shas[0].sourceDirtyHash ? `, ${shas[0].sourceDirty} dirty source path(s)` : ', clean tree'}) produced every recorded row${unrecorded ? `; ${unrecorded} repo(s) predate the receipt and are unrecorded` : ''}`
      : 'no repo carries a toolchain.json — the runner vintage is unrecorded for this whole batch, which is not the same as one vintage';
  return { distinct, recorded: entries.length - unrecorded, unrecorded, shas, mixed: distinct > 1, note };
}

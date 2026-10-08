// bin/lib/head-partition.mjs — run at HEAD only the test FILES that actually failed.
//
// WHY. The gate ran the whole suite twice per firing: once in the working tree, then again in a
// pristine HEAD worktree, to answer "is this failure mine or already committed?". Measured
// 2026-09-06: 596 test files, 621s for one clean run, so ~1250s per firing before contention.
//
// But that question is only ever asked about tests that FAILED, and failures are 0-13 of ~7500.
// On a clean turn the answer is needed for nothing, so the HEAD worktree need not exist at all.
//
// NAME -> FILE, BY ARTIFACT. `parseSuiteOutput` yields test NAMES (it matches `✖ <name> (<ms>`),
// not paths, and node's runner does not print the file beside the failure. So the file is found by
// searching the test sources for the name literal — an artifact lookup, not an identifier lookup,
// which is the form that survived every rename on this tree.
//
// FAIL CLOSED, AND SAY WHICH WAY. If ANY failing name cannot be located in exactly one place, the
// caller runs the full suite at HEAD as before. A partition computed from a partial mapping would
// silently call a committed failure uncommitted, which is the direction that assigns another
// session's breakage to whoever stopped last.

/** One read per file, not one per name: `files` may be ~600 long and `names` is usually < 15. */
export function filesForNames(names, files, readFile) {
  const wanted = [...new Set(names)].filter((n) => typeof n === 'string' && n.trim().length > 0);
  if (wanted.length === 0) return { files: [], unresolved: [], ambiguous: [] };

  const hitsByName = new Map(wanted.map((n) => [n, []]));
  for (const f of files) {
    let src = null;
    try { src = readFile(f); } catch { src = null; }
    if (src == null) continue;                       // unreadable file is not "no match"
    for (const n of wanted) if (src.includes(n)) hitsByName.get(n).push(f);
  }

  const chosen = new Set();
  const unresolved = [];
  const ambiguous = [];
  for (const [n, hits] of hitsByName) {
    if (hits.length === 0) { unresolved.push(n); continue; }
    // More than one file can legitimately declare the same test name. Take them all: running an
    // extra file is cheap, and dropping the real one is the error that matters.
    if (hits.length > 1) ambiguous.push({ name: n, files: [...hits] });
    for (const f of hits) chosen.add(f);
  }
  return { files: [...chosen].sort(), unresolved, ambiguous };
}

/**
 * Decide how to measure HEAD. Returns { mode: 'skip' | 'targeted' | 'full', files, why }.
 * `skip` when nothing failed — the comparison answers a question nobody asked.
 * `full` whenever the mapping is incomplete, so an unknown never becomes an attribution.
 */
export function headPlan(failedNames, files, readFile) {
  const names = [...new Set(failedNames ?? [])];
  if (names.length === 0) return { mode: 'skip', files: [], why: 'nothing failed in the working tree, so there is nothing to attribute' };

  const { files: hit, unresolved, ambiguous } = filesForNames(names, files, readFile);
  if (unresolved.length > 0) {
    return { mode: 'full', files: [], unresolved, why: `${unresolved.length} of ${names.length} failing test name(s) could not be located in any test file, so the partition would be computed from an incomplete mapping` };
  }
  if (hit.length === 0) return { mode: 'full', files: [], why: 'names resolved to no files' };
  return { mode: 'targeted', files: hit, ambiguous, why: `${hit.length} file(s) carry the ${names.length} failing test name(s)` };
}

/** The runner command for a targeted HEAD run. Mirrors package.json's flags; concurrency 1 is kept
 *  because a partitioning run must not introduce interference the working-tree run did not have. */
export function targetedCmd(files) {
  return `node --test --test-concurrency=1 ${files.map((f) => JSON.stringify(f)).join(' ')}`;
}

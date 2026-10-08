// Does a source PARSE? Nothing more — no linking, no evaluation, no imports resolved.
//
// fact: a tracked .mjs that does not parse takes an entire `node --test` glob down with a SyntaxError naming the GLOB, not the file / the run reports the wrong culprit, so the cost is paid by whoever next runs the suite rather than by whoever broke it (measured 2026-09-01, expiry: never, prev: unknown)
// fact: a rename sweep produced `const client-d = dryRun('client-d')` in monitor/test/scope-containment.test.mjs / a mechanical find/replace that substitutes inside an identifier yields a file that is still valid text and no longer valid JavaScript (measured 2026-09-01, expiry: never, prev: unknown)
//
// SEPARATE FROM tracked-imports.mjs ON PURPOSE. That module already detected unparseable sources,
// but only as a by-product of its import cross-check, so a syntax error surfaced as the test
// `V8 agrees with the extractor` failing — the wrong culprit again, one level up, which is the
// exact complaint this gate exists to answer. A gate for "this file does not parse" must say that.
//
// UNPARSEABLE IS ITS OWN STATE — not clean, not a finding. workflows/*.mjs are Workflow scripts run
// wrapped by that runtime, where a top-level `return` is legal and in a module is not. They are
// DECLARED here rather than pattern-skipped, so a new unparseable file fails loudly instead of
// landing in a category that quietly absorbs it.

/** Sources that legitimately do not parse as ES modules, each with the reason. */
export const NOT_MODULES = Object.freeze({
  'workflows/adversarial-review.mjs':
    'a Workflow script — the runtime wraps it, so its top-level `return` is legal there and illegal in a module',
});

/**
 * Parse failures across `entries`, a Map or array of [path, source].
 *
 * REQUIRES --experimental-vm-modules, and THROWS when it is absent rather than reporting an empty
 * list. A parse gate that cannot parse must not report a clean tree: that failure mode is
 * indistinguishable from success, which is the whole reason this file exists.
 */
export async function parseFailures(entries) {
  const vm = await import('node:vm');
  if (typeof vm.SourceTextModule !== 'function') {
    throw new Error('vm.SourceTextModule unavailable — run node with --experimental-vm-modules. '
      + 'Refusing to report zero parse failures from a checker that cannot parse.');
  }
  const out = [];
  for (const [path, src] of entries) {
    try {
      // Construction alone parses. It does not link, resolve a specifier, or run a line — verified
      // against monitor/rollup.mjs, which publishes during evaluation and stays `unlinked` here.
      new vm.SourceTextModule(String(src), { identifier: path });
    } catch (e) {
      out.push({ path, error: `${e.name}: ${e.message}`.slice(0, 200) });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Split parse failures into the ones that are declared-not-modules and the ones that are breakage.
 * Kept separate from `parseFailures` so the raw answer is never filtered before anyone sees it.
 */
export function classifyFailures(failures, declared = NOT_MODULES) {
  const breakage = [];
  const expected = [];
  for (const f of failures) (declared[f.path] ? expected : breakage).push(f);
  // A declared entry that now PARSES is also worth knowing: the declaration has gone stale and is
  // suppressing nothing, which is how an allowlist grows to outlive every reason in it.
  const parsedPaths = new Set(failures.map((f) => f.path));
  const staleDeclarations = Object.keys(declared).filter((p) => !parsedPaths.has(p));
  return { breakage, expected, staleDeclarations };
}

export default { NOT_MODULES, parseFailures, classifyFailures };

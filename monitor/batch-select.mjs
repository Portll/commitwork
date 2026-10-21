// WHICH batch an area rolls when the caller names none.
//
// Kept out of rollup.mjs because rollup.mjs SELF-EXECUTES: importing it runs a rollup and
// publishes. The selection rule is worth pinning, so it lives where a test can pin it without
// side effects.
//
// Taking the newest batch can take a `--repo`-narrowed sweep that landed after the last whole-area
// batch, and publish one repo as the whole area's headline: a false clean produced entirely by
// batch selection, with every scanner behaving correctly.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MODES = Object.freeze(['newest', 'newest-full']);

// `sweep.mjs --repo NAME` writes `only: NAME` into batch-manifest.json; a whole-area sweep writes
// none. That is the discriminator. `sweptAll` is NOT usable: batches do not set it reliably, so a
// policy keyed on it would refuse everything while looking like it worked.
const isFullArea = (dir) => {
  let m;
  try { m = JSON.parse(readFileSync(join(dir, 'batch-manifest.json'), 'utf8')); }
  catch { return false; }        // fail closed: unreadable is not evidence of a whole-area sweep
  return !m.only;
};

/**
 * @param covers  batches for this area, NEWEST FIRST (monitor/area.mjs batchesForArea)
 * @param mode    the area's declared `rollupBatch`; anything unrecognised behaves as 'newest'
 * @param onRefuse called instead of exiting, so the refusal is observable in a test
 */
export function pickBatch(covers, mode = 'newest', { onRefuse, log = console.error } = {}) {
  if (!covers || !covers.length) throw new Error('pickBatch: no candidate batches');
  if (mode !== 'newest-full') return covers[0].dir;

  const at = covers.findIndex((b) => isFullArea(b.dir));
  if (at >= 0) {
    if (at > 0) {
      log(`rollup: area declares rollupBatch:'newest-full' — skipping ${at} narrowed batch(es) and `
        + `rolling the newest that swept the whole area.`);
    }
    return covers[at].dir;
  }
  // FAIL CLOSED. Falling back to the newest narrowed batch is the defect, not the recovery: it
  // publishes part of the area as all of it, which is the shape nothing downstream can detect.
  log(`rollup: area declares rollupBatch:'newest-full' and NO batch swept the whole area — every `
    + `one of the ${covers.length} candidates was narrowed. Rolling one would publish part of the `
    + 'area as all of it.');
  log('rollup: run a whole-area sweep, or name a batch explicitly: node monitor/rollup.mjs <reportsDir>');
  return (onRefuse || ((n) => process.exit(n)))(4);
}

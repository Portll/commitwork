// lib/security-canary-rates.mjs — false-clean and false-alarm rates over planted canaries, per lane
// and in total. Unknown and not-run rows stay out of both denominators, so missing execution is
// never a correct negative; a rate with no eligible population is null.

const EXPECTED = new Set(['finding', 'clean']);
const OBSERVED = new Set(['finding', 'clean', 'unknown']);

const blank = () => ({ positives: 0, negatives: 0, falseClean: 0, falseAlarm: 0, unknown: 0, notRun: 0 });

function count(stats, { expected, observed, ran }) {
  if (!ran) { stats.notRun++; return; }
  if (observed === 'unknown') { stats.unknown++; return; }
  if (expected === 'finding') {
    stats.positives++;
    if (observed === 'clean') stats.falseClean++;
  } else {
    stats.negatives++;
    if (observed === 'finding') stats.falseAlarm++;
  }
}

const withRates = (s) => ({
  ...s,
  falseCleanRate: s.positives ? s.falseClean / s.positives : null,
  falseAlarmRate: s.negatives ? s.falseAlarm / s.negatives : null,
});

export function canaryRates(rows) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const seen = new Set();
  const lanes = new Map();
  const total = blank();
  for (const [i, row] of rows.entries()) {
    if (!row || typeof row !== 'object') throw new TypeError(`rows[${i}] must be an object`);
    const { id, lane, expected, observed, ran } = row;
    if (typeof id !== 'string' || id === '') throw new TypeError(`rows[${i}].id must be a non-empty string`);
    if (seen.has(id)) throw new Error(`duplicate canary id: ${id}`);
    seen.add(id);
    if (typeof lane !== 'string' || lane === '') throw new TypeError(`${id}: lane must be a non-empty string`);
    if (!EXPECTED.has(expected)) throw new TypeError(`${id}: expected must be finding or clean`);
    if (!OBSERVED.has(observed)) throw new TypeError(`${id}: observed must be finding, clean or unknown`);
    if (typeof ran !== 'boolean') throw new TypeError(`${id}: ran must be a boolean`);
    if (!ran && observed !== 'unknown') throw new Error(`${id}: observed ${observed} on a canary that did not run`);
    if (!lanes.has(lane)) lanes.set(lane, blank());
    count(lanes.get(lane), row);
    count(total, row);
  }
  const byLane = [...lanes.keys()].sort().map((lane) => ({ lane, ...withRates(lanes.get(lane)) }));
  return { lanes: byLane, total: withRates(total) };
}

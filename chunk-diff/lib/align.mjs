// align.mjs — N-way (2..6) alignment, base-relative: every non-base column is paired against the
// base document independently (pairChunks), then merged into rows ordered by the base document's
// own chunk sequence. True N-way multiple-sequence alignment is a materially harder problem than
// this needs to solve for a human comparing up to 6 outputs against one reference — base-relative
// pairing is the same simplification bifocal's design pass made for git refs ("resolving refs is
// an impure step that belongs one layer above the generator"), applied to column count instead.
import { pairChunks, STATE } from './chunk-identity.mjs';

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 6;

/**
 * @param columns    [{label, chunks: [{src}]}], columns.length in [MIN_COLUMNS, MAX_COLUMNS]
 * @param baseIndex  which column is the alignment reference (0-based)
 * @returns {{rows: [{perColumn: [pairOrNull, ...]}], extraRows: [{colIdx, pair}]}}
 *
 * `rows[i]` corresponds to the base column's i-th chunk. `extraRows` holds ADDED chunks from
 * non-base columns that have no base counterpart at all — they don't fit the base's row sequence
 * and are rendered as their own appended rows.
 *
 * KNOWN SIMPLIFICATION: when a non-base column's UNRESOLVED pair spans multiple base chunks
 * (a split/merge against the base), it is recorded only at the row of the FIRST base chunk it
 * spans; the other base rows it also covers are left null for that column rather than duplicated
 * or cross-linked. This is a real gap, stated here rather than silently accepted, because a
 * different column with a clean 1:1 match at one of those "swallowed" rows will still show its own
 * data there — the two are simply independent per-column judgments about the same base row.
 */
export function alignColumns(columns, baseIndex = 0) {
  if (columns.length < MIN_COLUMNS || columns.length > MAX_COLUMNS) {
    throw new Error(`alignColumns: expected ${MIN_COLUMNS}-${MAX_COLUMNS} columns, got ${columns.length}`);
  }
  if (baseIndex < 0 || baseIndex >= columns.length) {
    throw new Error(`alignColumns: baseIndex ${baseIndex} out of range`);
  }

  const base = columns[baseIndex];
  const rows = base.chunks.map(() => ({ perColumn: new Array(columns.length).fill(null) }));
  const extraRows = [];

  columns.forEach((col, colIdx) => {
    if (colIdx === baseIndex) {
      base.chunks.forEach((c, i) => {
        rows[i].perColumn[colIdx] = { state: STATE.MATCHED, old: null, new: { src: c.src }, isBase: true };
      });
      return;
    }
    const result = pairChunks(base.chunks, col.chunks);
    if (result.noBaseline) {
      // The base document itself has zero chunks — every column's content is ADDED relative to
      // it, with no rows to anchor them to. All become extra rows.
      for (const pair of result.pairs) extraRows.push({ colIdx, pair });
      return;
    }
    for (const pair of result.pairs) {
      if (pair.state === STATE.ADDED) { extraRows.push({ colIdx, pair }); continue; }
      const oldRef = Array.isArray(pair.old) ? pair.old[0] : pair.old;
      rows[oldRef.idx].perColumn[colIdx] = pair;
    }
  });

  return { rows, extraRows };
}

// A verified remediation candidate as SARIF 2.1.0 fixes[]. Regions refer to the ORIGINAL text:
// 1-based lines, 1-based UTF-16 columns, endColumn exclusive. One unprojectable file empties fixes[].
import { chosenCandidate, TIERS } from './remediation-contract.mjs';
import { parseUnifiedDiff } from './unified-diff.mjs';

const cmpStr = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const tierRank = (t) => (TIERS.includes(t) ? TIERS.indexOf(t) : TIERS.length);

// failed > undetermined > unverified; anything else (a verified candidate the tier rule rejected)
// ranks last rather than being promoted.
const STATUS_RANK = Object.freeze({ failed: 0, undetermined: 1, unverified: 2 });
const statusRank = (s) => STATUS_RANK[s] ?? 3;

const byFallback = (a, b) => statusRank(a.verification?.status) - statusRank(b.verification?.status)
  || tierRank(a.tier) - tierRank(b.tier) || cmpStr(a.tier, b.tier) || cmpStr(a.id, b.id);

/**
 * SARIF replacements for one parsed file diff, one per maximal run of '-'/'+' lines. Context lines
 * never enter a region. A run with deletions covers the whole deleted span and inserts the run's
 * '+' lines; a run of insertions only is a zero-length region at the line it precedes.
 */
export function replacementsForFileDiff(fileDiff) {
  const out = [];
  for (const h of fileDiff?.hunks ?? []) {
    const oldLast = h.oldStart + h.oldLines - 1;
    const newLast = h.newStart + h.newLines - 1;
    let cursor = h.oldLines === 0 ? h.oldStart + 1 : h.oldStart;
    let newCursor = h.newLines === 0 ? h.newStart + 1 : h.newStart;
    let run = null;
    const flush = (insertAt) => {
      if (!run) return;
      const insertedText = run.inserted
        .map((it) => it.text + (it.newLine === newLast && h.newNoNewline ? '' : '\n'))
        .join('');
      if (run.deleted.length) {
        const first = run.deleted[0];
        const last = run.deleted[run.deleted.length - 1];
        const atEndWithoutNewline = last.line === oldLast && h.oldNoNewline;
        const replacement = {
          deletedRegion: {
            startLine: first.line,
            startColumn: 1,
            endLine: atEndWithoutNewline ? last.line : last.line + 1,
            endColumn: atEndWithoutNewline ? last.text.length + 1 : 1,
          },
        };
        if (insertedText !== '') replacement.insertedContent = { text: insertedText };
        out.push(replacement);
      } else {
        out.push({
          deletedRegion: { startLine: insertAt, startColumn: 1, endLine: insertAt, endColumn: 1 },
          insertedContent: { text: insertedText },
        });
      }
      run = null;
    };
    for (const line of h.lines) {
      const kind = line[0];
      if (kind === ' ') {
        flush(cursor);
        cursor += 1;
        newCursor += 1;
        continue;
      }
      if (!run) run = { deleted: [], inserted: [] };
      if (kind === '-') {
        run.deleted.push({ line: cursor, text: line.slice(1) });
        cursor += 1;
      } else {
        run.inserted.push({ text: line.slice(1), newLine: newCursor });
        newCursor += 1;
      }
    }
    flush(cursor);
  }
  return out;
}

const lineStarts = (lines) => {
  const starts = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    starts[i] = offset;
    offset += lines[i].length + 1;
  }
  return starts;
};

const pointOffset = (lines, starts, line, column) => {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
  if (line > lines.length || column > lines[line - 1].length + 1) return null;
  return starts[line - 1] + column - 1;
};

/**
 * Apply SARIF replacements to their original text. Throws on a region outside the text and on
 * overlapping regions; both are conditions under which a guessed result would be worse than none.
 */
export function applySarifReplacements(text, replacements) {
  const src = String(text ?? '');
  const lines = src.split('\n');
  const starts = lineStarts(lines);
  const regions = (replacements ?? []).map((r) => {
    const region = r?.deletedRegion;
    const start = region && pointOffset(lines, starts, region.startLine, region.startColumn);
    const end = region && pointOffset(lines, starts, region.endLine, region.endColumn);
    if (!region || start === null || end === null) throw new Error('sarif replacement: deletedRegion is outside the text');
    if (end < start) throw new Error('sarif replacement: deletedRegion ends before it starts');
    return { start, end, text: String(r.insertedContent?.text ?? '') };
  });
  const ordered = regions.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      if (a.start < b.end && b.start < a.end) throw new Error('sarif replacement: regions overlap');
    }
  }
  let out = src;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const r = ordered[i];
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

const pathOf = (f) => f.newPath ?? f.oldPath;

function unprojectableReason(f) {
  if (f.oldPath === null && f.newPath === null) return 'the patch names no path';
  if (f.oldPath === null) return 'the patch creates this file';
  if (f.newPath === null) return 'the patch deletes this file';
  if (f.oldPath !== f.newPath) return 'the patch renames this file';
  if (!(f.hunks ?? []).length) return 'the patch changes no content in this file';
  return null;
}

const parsePatch = (patch) => (typeof patch === 'string' && patch !== '' ? parseUnifiedDiff(patch) : []);

/** `{ fixes, unprojectable }` for one finding: only a verified candidate ever becomes a fix. */
export function sarifFixes(finding) {
  const candidate = chosenCandidate(finding);
  if (!candidate) return { fixes: [], unprojectable: [] };
  const files = parsePatch(candidate.patch);
  if (!files.length) return { fixes: [], unprojectable: [{ path: null, reason: 'the candidate carries no patch' }] };
  const unprojectable = [];
  const changes = [];
  for (const f of files) {
    const reason = unprojectableReason(f);
    if (reason) { unprojectable.push({ path: pathOf(f), reason }); continue; }
    changes.push({
      artifactLocation: { uri: pathOf(f), uriBaseId: '%SRCROOT%' },
      replacements: replacementsForFileDiff(f),
    });
  }
  if (unprojectable.length) {
    unprojectable.sort((a, b) => cmpStr(a.path, b.path));
    return { fixes: [], unprojectable };
  }
  changes.sort((a, b) => cmpStr(a.artifactLocation.uri, b.artifactLocation.uri));
  const p = candidate.provenance || {};
  const who = p.tool || p.model || 'unknown';
  const version = p.version || 'unknown';
  const lanes = [...(candidate.verification?.witness?.lanes ?? [])].sort(cmpStr);
  return {
    fixes: [{
      description: { text: `${candidate.tier} fix (${who} ${version}), verified by re-running ${lanes.join(', ')}` },
      artifactChanges: changes,
    }],
    unprojectable: [],
  };
}

/**
 * The `result.properties.commitwork.remediation` object for one finding. The chosen verified
 * candidate wins; otherwise the strongest unverified status is reported as it stands, never as a
 * pass. No candidates means the finding carries no remediation property at all.
 */
export function remediationProperty(finding) {
  const candidates = (Array.isArray(finding?.candidates) ? finding.candidates : []).filter(Boolean);
  if (!candidates.length) return null;
  const chosen = chosenCandidate(finding);
  const candidate = chosen || [...candidates].sort(byFallback)[0];
  const v = candidate.verification || {};
  const w = v.witness || {};
  return {
    tier: candidate.tier,
    fixStatus: v.status,
    witness: {
      lanes: [...(w.lanes ?? [])].sort(cmpStr),
      before: w.before ?? null,
      after: w.after ?? null,
      digest: w.digest ?? null,
    },
    undeterminedReason: v.status === 'undetermined' ? (v.reason ?? null) : null,
  };
}
